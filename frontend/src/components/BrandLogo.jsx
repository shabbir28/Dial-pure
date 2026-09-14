export default function BrandLogo({ className = '', alt = 'DialPure' }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/logo.png"
      alt={alt}
      width="48"
      height="48"
    />
  );
}
