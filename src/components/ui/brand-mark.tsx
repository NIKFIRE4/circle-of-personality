import Image from "next/image";
import Link from "next/link";

export function BrandMark({ href = "/overview" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="КОНТУР.КОСТРОВ — на главную">
      <span className="brand-logo-frame" aria-hidden="true">
        <Image className="brand-logo" src="/logo.webp" alt="" width={48} height={48} />
      </span>
      <span className="brand-word">КОНТУР.КОСТРОВ</span>
    </Link>
  );
}
