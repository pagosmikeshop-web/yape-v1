import Link from "next/link";
import { AssetIcon } from "./primitives";

export function InnerHeader({
  title,
  backHref = "/inicio",
  compact = false,
}: {
  title: string;
  backHref?: string;
  compact?: boolean;
}) {
  return (
    <header className={`inner-header${compact ? " is-compact" : ""}`}>
      <Link href={backHref} className="inner-back" aria-label="Volver">
        <AssetIcon name="ic_arrow_left_yape_on_primary" />
      </Link>
      <h1>{title}</h1>
      <span className="inner-header-spacer" aria-hidden="true" />
    </header>
  );
}
