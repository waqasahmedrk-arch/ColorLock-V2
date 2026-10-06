// A user's profile photo, or their initials on the brand gradient when there is none.

export function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export default function Avatar({ name, src, size = 36, className }: {
  name: string;
  src: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`avatar${className ? ` ${className}` : ""}`}
          style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {src ? (
        // Signed, expiring API URL: next/image would cache it past its expiry.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
