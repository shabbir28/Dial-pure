import "./Button.css";

export default function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  block = false,
  size,
  ...props
}) {
  return (
    <button
      type={type}
      className={`btn btn--${variant}${size ? ` btn--${size}` : ""}${block ? " btn--block" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
