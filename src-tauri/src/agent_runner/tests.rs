use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tempfile::TempDir;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::time::Instant;

/// How long a test waits for an event before failing.
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
enum Event {
    Line(LineEvent),
    Exit(ExitEvent),
}

struct Recorder(UnboundedSender<Event>);

impl RunEvents for Recorder {
    fn line(&self, event: LineEvent) {
        let _ = self.0.send(Event::Line(event));
    }

    fn exit(&self, event: ExitEvent) {
        let _ = self.0.send(Event::Exit(event));
    }
}

/// Answers every question with `answer` and records each message it was asked.
struct Answers {
    answer: AtomicBool,
    asked: Mutex<Vec<(String, String)>>,
}

impl Confirm for Answers {
    fn confirm(&self, title: &str, message: &str) -> bool {
        lock(&self.asked).push((title.to_owned(), message.to_owned()));
        self.answer.load(Ordering::SeqCst)
    }
}

/// Short waits, so stops in tests take a fraction of a second.
fn test_limits() -> Limits {
    Limits {
        graces: StopGraces {
            stdin: Duration::from_millis(300),
            term: Duration::from_millis(300),
        },
        exit_graces: StopGraces {
            stdin: Duration::from_millis(100),
            term: Duration::from_millis(100),
        },
        ..Limits::default()
    }
}

struct Harness {
    runner: AgentRunner,
    events: UnboundedReceiver<Event>,
    answers: Arc<Answers>,
    logs: TempDir,
    data: TempDir,
    cwd: TempDir,
}

fn harness(limits: Limits) -> Harness {
    let (tx, events) = unbounded_channel();
    let logs = TempDir::new().unwrap();
    let data = TempDir::new().unwrap();
    let answers = Arc::new(Answers {
        answer: AtomicBool::new(true),
        asked: Mutex::new(Vec::new()),
    });
    let runner = AgentRunner::new(
        Arc::new(Recorder(tx)),
        answers.clone(),
        Some(data.path().join(allow_list::FILE_NAME)),
        Some(logs.path().to_path_buf()),
        limits,
    );
    Harness {
        runner,
        events,
        answers,
        logs,
        data,
        cwd: TempDir::new().unwrap(),
    }
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

/// The full path of a checked-in test agent. Scripts written at test time can be busy for exec
/// while another test thread forks.
fn agent(name: &str) -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/agent_runner/test_agents")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

impl Harness {
    fn cwd(&self) -> String {
        self.cwd.path().to_string_lossy().into_owned()
    }

    /// Allows `script` without arguments, then starts it.
    async fn start(&self, script: &str) -> String {
        assert!(self.runner.allow(&agent(script), Vec::new()).await.unwrap());
        self.runner
            .start(&agent(script), Vec::new(), &self.cwd())
            .await
            .unwrap()
    }

    fn questions(&self) -> usize {
        lock(&self.answers.asked).len()
    }

    async fn next_event(&mut self) -> Event {
        timeout(EVENT_TIMEOUT, self.events.recv())
            .await
            .expect("an event arrives")
            .expect("the runner is alive")
    }

    async fn next_line(&mut self) -> LineEvent {
        match self.next_event().await {
            Event::Line(line) => line,
            Event::Exit(exit) => panic!("expected a line, the run ended: {exit:?}"),
        }
    }

    /// The exit event of the next run to end, skipping lines.
    async fn next_exit(&mut self) -> ExitEvent {
        loop {
            if let Event::Exit(exit) = self.next_event().await {
                return exit;
            }
        }
    }
}

#[test]
fn run_ids_are_ar_and_sixteen_url_safe_characters() {
    let id = new_run_id().unwrap();
    let rest = id.strip_prefix("ar_").expect("the prefix");
    assert_eq!(rest.len(), 16);
    assert!(rest
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    assert_ne!(new_run_id().unwrap(), id);
}

#[test]
fn events_have_the_page_field_names() {
    let exit = ExitEvent {
        run_id: "ar_x".into(),
        code: Some(0),
        signal: None,
        reason: None,
        stderr_tail: vec!["a".into()],
    };
    assert_eq!(
        serde_json::to_value(exit).unwrap(),
        serde_json::json!({
            "runId": "ar_x",
            "code": 0,
            "signal": null,
            "reason": null,
            "stderrTail": ["a"],
        })
    );
    let info = RunInfo {
        run_id: "ar_x".into(),
        program: "/bin/a".into(),
        cwd: "/".into(),
        started_at: 5,
    };
    assert_eq!(
        serde_json::to_value(info).unwrap(),
        serde_json::json!({ "runId": "ar_x", "program": "/bin/a", "cwd": "/", "startedAt": 5 })
    );
}

#[test]
fn sizes_are_described_in_mib_when_whole() {
    assert_eq!(describe_size(4 * MIB), "4 MiB");
    assert_eq!(describe_size(10), "10 bytes");
}

#[tokio::test]
async fn a_relative_or_missing_program_is_refused() {
    let h = harness(test_limits());
    let cwd = h.cwd();
    for (program, expected) in [
        ("test_agents/echo.sh", "not a relative path"),
        ("./echo.sh", "not a relative path"),
        ("", "Choose the program"),
        ("/nonexistent/rim-agent", "does not exist"),
        ("rim-agent-that-is-nowhere", "No program named"),
    ] {
        let error = h
            .runner
            .start(program, Vec::new(), &cwd)
            .await
            .expect_err(program);
        assert!(error.contains(expected), "{program}: {error}");
    }
    assert!(h.runner.list().is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_that_cannot_run_is_refused() {
    let h = harness(test_limits());
    let file = h.cwd.path().join("notes.txt");
    std::fs::write(&file, "text").unwrap();
    let error = h
        .runner
        .start(&file.to_string_lossy(), Vec::new(), &h.cwd())
        .await
        .unwrap_err();
    assert!(error.contains("not a program that can be run"), "{error}");
    let error = h
        .runner
        .start(&h.cwd(), Vec::new(), &h.cwd())
        .await
        .unwrap_err();
    assert!(error.contains("not a program that can be run"), "{error}");
}

#[tokio::test]
async fn a_bad_working_folder_is_refused() {
    let h = harness(test_limits());
    let file = h.cwd.path().join("file");
    std::fs::write(&file, "x").unwrap();
    let missing = h.cwd.path().join("missing");
    for (cwd, expected) in [
        ("relative/folder".to_owned(), "must be a full path"),
        (String::new(), "must be a full path"),
        (missing.to_string_lossy().into_owned(), "does not exist"),
        (file.to_string_lossy().into_owned(), "is not a folder"),
    ] {
        let error = h
            .runner
            .start(&agent("echo.sh"), Vec::new(), &cwd)
            .await
            .expect_err(&cwd);
        assert!(error.contains(expected), "{cwd}: {error}");
    }
}

#[cfg(unix)]
mod processes {
    use super::*;

    #[tokio::test]
    async fn lines_go_both_ways_in_order() {
        let mut h = harness(test_limits());
        let run_id = h.start("echo.sh").await;
        assert!(run_id.starts_with("ar_"));

        for line in [
            "{\"jsonrpc\":\"2.0\",\"id\":1}",
            "",
            "  spaced  ",
            "ünïcode",
        ] {
            h.runner.send(&run_id, line.to_owned()).await.unwrap();
        }
        for expected in [
            "{\"jsonrpc\":\"2.0\",\"id\":1}",
            "",
            "  spaced  ",
            "ünïcode",
        ] {
            assert_eq!(
                h.next_line().await,
                LineEvent {
                    run_id: run_id.clone(),
                    line: expected.to_owned()
                }
            );
        }
        h.runner.stop(&run_id).await;
    }

    #[tokio::test]
    async fn a_line_with_a_line_break_is_refused() {
        let mut h = harness(test_limits());
        let run_id = h.start("echo.sh").await;
        for line in ["a\nb", "a\rb", "trailing\n"] {
            let error = h.runner.send(&run_id, line.to_owned()).await.unwrap_err();
            assert!(error.contains("line break"), "{error}");
        }
        h.runner.send(&run_id, "fine".to_owned()).await.unwrap();
        assert_eq!(h.next_line().await.line, "fine");
        h.runner.stop(&run_id).await;
    }

    #[tokio::test]
    async fn a_line_over_the_send_limit_is_refused() {
        let mut h = harness(Limits {
            max_send: 8,
            ..test_limits()
        });
        let run_id = h.start("echo.sh").await;
        let error = h
            .runner
            .send(&run_id, "123456789".to_owned())
            .await
            .unwrap_err();
        assert!(error.contains("at most 8 bytes"), "{error}");
        h.runner.send(&run_id, "12345678".to_owned()).await.unwrap();
        assert_eq!(h.next_line().await.line, "12345678");
        h.runner.stop(&run_id).await;
    }

    #[tokio::test]
    async fn sending_to_a_run_that_is_not_running_is_refused() {
        let h = harness(test_limits());
        let error = h
            .runner
            .send("ar_nothing", "hi".to_owned())
            .await
            .unwrap_err();
        assert_eq!(error, NOT_RUNNING);
    }

    #[tokio::test]
    async fn the_exit_event_has_the_code_and_the_stderr_tail() {
        let mut h = harness(test_limits());
        let run_id = h.start("fails.sh").await;
        let exit = h.next_exit().await;
        assert_eq!(
            exit,
            ExitEvent {
                run_id: run_id.clone(),
                code: Some(3),
                signal: None,
                reason: None,
                stderr_tail: vec!["first problem".into(), "last problem".into()],
            }
        );
        assert!(h.runner.list().is_empty());
        let log = std::fs::read_to_string(h.logs.path().join(format!("{run_id}.log"))).unwrap();
        assert_eq!(log, "first problem\nlast problem");
    }

    #[tokio::test]
    async fn stopping_closes_stdin_first() {
        let mut h = harness(test_limits());
        let run_id = h.start("echo.sh").await;
        h.runner.send(&run_id, "hello".to_owned()).await.unwrap();
        assert_eq!(h.next_line().await.line, "hello");

        let started = Instant::now();
        h.runner.stop(&run_id).await;
        assert!(started.elapsed() < Duration::from_millis(300));
        let exit = h.next_exit().await;
        assert_eq!(exit.code, Some(7));
        assert_eq!(exit.reason.as_deref(), Some(REASON_STOPPED));
        assert_eq!(
            exit.stderr_tail,
            vec!["agent starting", "got hello", "agent done"]
        );
        assert!(h.runner.list().is_empty());
    }

    #[tokio::test]
    async fn a_run_that_ignores_sigterm_is_killed_after_the_graces() {
        let mut h = harness(test_limits());
        let run_id = h.start("ignores_sigterm.sh").await;
        let started = Instant::now();
        h.runner.stop(&run_id).await;
        let elapsed = started.elapsed();
        assert!(elapsed >= Duration::from_millis(600), "{elapsed:?}");
        let exit = h.next_exit().await;
        assert_eq!(exit.run_id, run_id);
        assert_eq!(exit.code, None);
        assert_eq!(exit.signal, Some(libc::SIGKILL));
        assert_eq!(exit.reason.as_deref(), Some(REASON_STOPPED));
    }

    #[tokio::test]
    async fn stopping_is_idempotent() {
        let mut h = harness(test_limits());
        let run_id = h.start("echo.sh").await;
        h.runner.stop(&run_id).await;
        h.runner.stop(&run_id).await;
        h.runner.stop("ar_nothing").await;
        h.next_exit().await;
        assert!(timeout(Duration::from_millis(200), h.events.recv())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn what_a_run_started_ends_with_it() {
        let mut h = harness(test_limits());
        let run_id = h.start("leaves_child.sh").await;
        let child: i32 = h.next_line().await.line.parse().unwrap();
        // SAFETY: kill(2) with signal 0 only checks that the process exists.
        assert_eq!(unsafe { libc::kill(child, 0) }, 0);
        h.runner.stop(&run_id).await;
        let exit = h.next_exit().await;
        assert_eq!(exit.code, Some(0));

        let deadline = Instant::now() + Duration::from_secs(5);
        // SAFETY: as above.
        while unsafe { libc::kill(child, 0) } == 0 {
            assert!(Instant::now() < deadline, "the child is still running");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test]
    async fn an_overlong_line_ends_the_run() {
        let mut h = harness(Limits {
            max_line: 50,
            ..test_limits()
        });
        let run_id = h.start("long_line.sh").await;
        assert_eq!(h.next_line().await.line, "short");
        let exit = h.next_exit().await;
        assert_eq!(exit.run_id, run_id);
        assert_eq!(exit.reason.as_deref(), Some(REASON_LINE_TOO_LONG));
        assert_eq!(exit.signal, Some(libc::SIGKILL));
        assert!(h.runner.list().is_empty());
    }

    #[tokio::test]
    async fn at_most_the_limit_of_runs_run_at_once() {
        let mut h = harness(Limits {
            max_runs: 2,
            ..test_limits()
        });
        let first = h.start("echo.sh").await;
        let second = h.start("echo.sh").await;
        let error = h
            .runner
            .start(&agent("echo.sh"), Vec::new(), &h.cwd())
            .await
            .unwrap_err();
        assert!(error.contains("At most 2 agents"), "{error}");

        let listed: Vec<String> = h.runner.list().into_iter().map(|r| r.run_id).collect();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&first) && listed.contains(&second));

        h.runner.stop(&first).await;
        h.next_exit().await;
        let third = h.start("echo.sh").await;
        h.runner.stop(&second).await;
        h.runner.stop(&third).await;
    }

    #[tokio::test]
    async fn the_list_shows_the_program_and_folder() {
        let h = harness(test_limits());
        let run_id = h.start("echo.sh").await;
        let runs = h.runner.list();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, run_id);
        assert_eq!(runs[0].program, agent("echo.sh"));
        assert_eq!(runs[0].cwd, h.cwd());
        assert!(runs[0].started_at > 0);
        h.runner.stop(&run_id).await;
    }

    #[tokio::test]
    async fn a_bare_name_is_found_on_path_and_gets_its_arguments() {
        let mut h = harness(test_limits());
        let args = vec![
            "-c".to_owned(),
            "printf '%s|%s\\n' \"$1\" \"$(pwd -P)\"".to_owned(),
            "sh".to_owned(),
            "two words".to_owned(),
        ];
        assert!(h.runner.allow("sh", args.clone()).await.unwrap());
        let run_id = h.runner.start("sh", args, &h.cwd()).await.unwrap();
        let line = h.next_line().await.line;
        let cwd = std::fs::canonicalize(h.cwd.path()).unwrap();
        assert_eq!(line, format!("two words|{}", cwd.display()));
        let exit = h.next_exit().await;
        assert_eq!(
            (exit.run_id, exit.code, exit.reason),
            (run_id, Some(0), None)
        );
    }

    #[tokio::test]
    async fn app_exit_stops_every_run() {
        let mut h = harness(test_limits());
        h.start("echo.sh").await;
        h.start("ignores_sigterm.sh").await;
        h.runner.stop_all_within(Duration::from_secs(5)).await;
        assert!(h.runner.list().is_empty());
        for _ in 0..2 {
            assert_eq!(h.next_exit().await.reason.as_deref(), Some(REASON_STOPPED));
        }
    }

    #[tokio::test]
    async fn find_resolves_names_on_path() {
        let h = harness(test_limits());
        let found = h
            .runner
            .find(&[
                "sh".into(),
                "rim-agent-that-is-nowhere".into(),
                "bin/sh".into(),
            ])
            .await
            .unwrap();
        assert!(found[0]
            .as_deref()
            .is_some_and(|path| path.ends_with("/sh")));
        assert_eq!(found[1], None);
        assert_eq!(found[2], None);
        let too_many = vec!["sh".to_owned(); MAX_FIND_NAMES + 1];
        assert!(h.runner.find(&too_many).await.is_err());
    }
}

#[test]
fn the_question_names_the_program_each_argument_and_the_risk() {
    let message = allow_message(
        "/usr/bin/agent",
        &strings(&["--acp", "two words", "", "a\nb", "x\u{202e}y", " padded"]),
    );
    assert_eq!(
        message,
        "/usr/bin/agent\n--acp\ntwo words\n\"\"\n\"a\\nb\"\n\"x\\u{202e}y\"\n\" padded\"\n\n\
         It runs as you, with access to your files and anything you can do. \
         RIM doesn't sandbox it."
    );
}

#[tokio::test]
async fn an_unlisted_program_is_refused() {
    let h = harness(test_limits());
    let error = h
        .runner
        .start(&agent("echo.sh"), Vec::new(), &h.cwd())
        .await
        .unwrap_err();
    assert_eq!(error, NOT_ALLOWED);
    assert_eq!(h.questions(), 0);
}

#[tokio::test]
async fn a_program_with_other_arguments_is_refused() {
    let h = harness(test_limits());
    let program = agent("echo.sh");
    assert!(h.runner.allow(&program, strings(&["--a"])).await.unwrap());
    for args in [&[][..], &["--b"][..], &["--a", "--b"][..]] {
        let error = h
            .runner
            .start(&program, strings(args), &h.cwd())
            .await
            .unwrap_err();
        assert_eq!(error, NOT_ALLOWED, "{args:?}");
    }
}

#[tokio::test]
async fn allowing_asks_once_and_keeps_the_full_path() {
    let h = harness(test_limits());
    let program = agent("echo.sh");
    assert!(h.runner.allow(&program, strings(&["x"])).await.unwrap());
    assert!(h.runner.allow(&program, strings(&["x"])).await.unwrap());
    assert_eq!(h.questions(), 1);
    let (title, message) = lock(&h.answers.asked)[0].clone();
    assert_eq!(title, ALLOW_TITLE);
    assert!(message.starts_with(&format!("{program}\nx\n\n")));
    assert_eq!(
        h.runner.allowed(),
        vec![AllowedProgram {
            program,
            args: strings(&["x"]),
        }]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_bare_name_is_allowed_as_its_full_path() {
    let h = harness(test_limits());
    assert!(h.runner.allow("sh", Vec::new()).await.unwrap());
    let allowed = h.runner.allowed();
    assert_eq!(allowed.len(), 1);
    assert!(Path::new(&allowed[0].program).is_absolute());
    assert!(allowed[0].program.ends_with("/sh"));
    h.runner.forget("sh", &[]).await.unwrap();
    assert!(h.runner.allowed().is_empty());
}

#[tokio::test]
async fn cancel_allows_nothing() {
    let h = harness(test_limits());
    h.answers.answer.store(false, Ordering::SeqCst);
    let program = agent("echo.sh");
    assert!(!h.runner.allow(&program, Vec::new()).await.unwrap());
    assert!(h.runner.allowed().is_empty());
    let error = h
        .runner
        .start(&program, Vec::new(), &h.cwd())
        .await
        .unwrap_err();
    assert_eq!(error, NOT_ALLOWED);
}

#[tokio::test]
async fn forgetting_a_program_refuses_it_again() {
    let h = harness(test_limits());
    let program = agent("echo.sh");
    assert!(h.runner.allow(&program, Vec::new()).await.unwrap());
    h.runner.forget(&program, &[]).await.unwrap();
    h.runner.forget(&program, &[]).await.unwrap();
    assert!(h.runner.allowed().is_empty());
    let error = h
        .runner
        .start(&program, Vec::new(), &h.cwd())
        .await
        .unwrap_err();
    assert_eq!(error, NOT_ALLOWED);
}

#[tokio::test]
async fn the_allow_list_outlives_the_runner() {
    let h = harness(test_limits());
    let program = agent("echo.sh");
    assert!(h.runner.allow(&program, strings(&["--acp"])).await.unwrap());
    let (tx, _events) = unbounded_channel();
    let again = AgentRunner::new(
        Arc::new(Recorder(tx)),
        h.answers.clone(),
        Some(h.data.path().join(allow_list::FILE_NAME)),
        None,
        test_limits(),
    );
    assert_eq!(again.allowed(), h.runner.allowed());
}

#[tokio::test]
async fn allowing_refuses_a_bad_program_or_too_many_arguments() {
    let h = harness(test_limits());
    let error = h.runner.allow("bin/agent", Vec::new()).await.unwrap_err();
    assert!(error.contains("not a relative path"), "{error}");
    let error = h
        .runner
        .allow(&agent("echo.sh"), vec!["a".to_owned(); MAX_ALLOW_ARGS + 1])
        .await
        .unwrap_err();
    assert!(error.contains("at most 32 arguments"), "{error}");
    let error = h
        .runner
        .allow(&agent("echo.sh"), vec!["a".repeat(MAX_ALLOW_ARG_LEN + 1)])
        .await
        .unwrap_err();
    assert!(error.contains("at most 512 characters"), "{error}");
    assert_eq!(h.questions(), 0);
}

#[tokio::test]
async fn a_full_list_refuses_without_asking() {
    let h = harness(test_limits());
    let program = agent("echo.sh");
    for i in 0..allow_list::MAX_ENTRIES {
        assert!(h.runner.allow(&program, vec![i.to_string()]).await.unwrap());
    }
    let asked = h.questions();
    let error = h
        .runner
        .allow(&program, strings(&["more"]))
        .await
        .unwrap_err();
    assert!(error.contains("At most 32 programs"), "{error}");
    assert_eq!(h.questions(), asked);
    assert!(h.runner.allow(&program, strings(&["0"])).await.unwrap());
}
