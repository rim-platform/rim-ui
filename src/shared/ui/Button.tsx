import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  isLoading?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-rim-accent text-rim-void hover:bg-rim-accent-strong",
  secondary: "border border-rim-line bg-rim-void text-rim-text-muted hover:text-rim-text",
  danger: "bg-rim-danger text-rim-void hover:bg-rim-danger/90",
  ghost: "text-rim-text-muted hover:text-rim-text hover:bg-white/5",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-4 py-2 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isLoading, className, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={cn(
        "rounded-lg font-medium transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rim-accent",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...rest}
    >
      {isLoading ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
});
