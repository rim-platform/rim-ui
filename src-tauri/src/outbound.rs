//! Which addresses the app's own outgoing fetches of other people's links may reach: the public
//! internet only, never this computer, the local network or a cloud metadata address.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Whether `ip` is reachable on the public internet. IPv4 refused: "this network" (0.0.0.0/8,
/// unspecified included), private, loopback, link-local, shared (100.64.0.0/10), IETF protocol
/// assignments (192.0.0.0/24), benchmarking, documentation, multicast and reserved
/// (240.0.0.0/4, broadcast included). IPv6 is public only inside global unicast (2000::/3),
/// which leaves out unspecified, loopback, discard-only, local-use NAT64 (64:ff9b:1::/48),
/// unique-local, link-local, site-local and multicast; inside it, the IETF protocol assignments
/// (2001::/23: Teredo, benchmarking, ORCHID) and documentation are refused. IPv4-mapped,
/// IPv4-compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16) addresses are judged by the IPv4
/// address they embed.
pub(crate) fn is_public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(v4: Ipv4Addr) -> bool {
    let [a, b, c, _] = v4.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (b & 0xc0) == 64)
        || (a == 169 && b == 254)
        || (a == 172 && (b & 0xf0) == 16)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 168)
        || (a == 198 && (b & 0xfe) == 18)
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_v6(v6: Ipv6Addr) -> bool {
    let s = v6.segments();
    let o = v6.octets();
    let embedded = |i: usize| Ipv4Addr::new(o[i], o[i + 1], o[i + 2], o[i + 3]);
    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96, `::` and `::1` included).
    if s[..5] == [0; 5] && (s[5] == 0 || s[5] == 0xffff) {
        return is_public_v4(embedded(12));
    }
    // NAT64 well-known prefix (64:ff9b::/96).
    if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        return is_public_v4(embedded(12));
    }
    // 6to4 (2002::/16): the IPv4 address follows the prefix.
    if s[0] == 0x2002 {
        return is_public_v4(embedded(2));
    }
    let global_unicast = (s[0] & 0xe000) == 0x2000;
    let protocol_or_documentation = s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8);
    let new_documentation = s[0] == 0x3fff && s[1] < 0x1000;
    global_unicast && !protocol_or_documentation && !new_documentation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_public_addresses_are_refused() {
        for ip in [
            // IPv4
            "0.0.0.0",
            "0.1.2.3",
            "127.0.0.1",
            "127.255.255.254",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "100.100.100.200",
            "192.0.0.170",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "198.18.0.1",
            "198.19.255.255",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
            // IPv6
            "::",
            "::1",
            "fc00::1",
            "fd00:ec2::254",
            "fe80::1",
            "fec0::1",
            "ff02::1",
            "100::1",
            "2001::1",
            "2001:0:4136:e378:8000:63bf:3fff:fdd2",
            "2001:2::1",
            "2001:10::1",
            "2001:db8::1",
            "3fff::1",
            "3fff:fff::1",
            "5f00::1",
            "4000::1",
            "::ffff:0:7f00:1",
            // Embedded IPv4, judged by the IPv4 address
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "::7f00:1",
            "::a00:1",
            "64:ff9b::7f00:1",
            "64:ff9b::a9fe:a9fe",
            "64:ff9b::f000:1",
            "2002:7f00:1::1",
            "2002:a9fe:a9fe::",
            "2002:c0a8:101::1",
            // Local-use NAT64, refused whatever it embeds
            "64:ff9b:1::808:808",
            "64:ff9b:1:7f00:1::",
        ] {
            assert!(
                !is_public_address(ip.parse().expect("ip")),
                "{ip} must be refused"
            );
        }
    }

    #[test]
    fn public_addresses_are_accepted() {
        for ip in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "100.128.0.1",
            "172.32.0.1",
            "192.0.1.1",
            "198.20.0.1",
            "223.255.255.254",
            "2606:4700::1111",
            "2606:2800:220:1::1",
            "2a00:1450:4001:80b::200e",
            "2001:4860:4860::8888",
            "3ffe:1::1",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
            "2002:808:808::1",
        ] {
            assert!(
                is_public_address(ip.parse().expect("ip")),
                "{ip} must be accepted"
            );
        }
    }
}
