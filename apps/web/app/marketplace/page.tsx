import Link from "next/link";
import { BadgeCheck, Box, Download, Search, Star } from "lucide-react";
import { marketplace } from "../../lib/control-plane";

export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const values = await searchParams;
  const text = typeof values.search === "string" ? values.search : "";
  const pricing =
    values.pricing === "free" || values.pricing === "paid"
      ? values.pricing
      : "all";
  const sort =
    values.sort === "installs" || values.sort === "rating"
      ? values.sort
      : "recent";
  const verified = values.verified === "true";
  const query = new URLSearchParams({
    hostVersion: "0.3.0",
    limit: "24",
    pricing,
    sort,
    verifiedOnly: String(verified),
  });
  if (text) query.set("search", text);
  const result = await marketplace(query);
  return (
    <main>
      <section className="market-hero">
        <div className="eyebrow">Capability-controlled integrations</div>
        <h1>
          Extend workflows.
          <br />
          Keep the machine boundary.
        </h1>
        <p>
          Every package is immutable, signed and reviewed. You approve exactly
          what it can reach before its nodes become available.
        </p>
        <form className="search-form">
          <Search size={17} />
          <input
            name="search"
            defaultValue={text}
            placeholder="Search plugins, nodes and publishers"
          />
          <select name="pricing" defaultValue={pricing}>
            <option value="all">Free & paid</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
          <select name="sort" defaultValue={sort}>
            <option value="recent">Recently updated</option>
            <option value="installs">Most installed</option>
            <option value="rating">Highest rated</option>
          </select>
          <label>
            <input
              type="checkbox"
              name="verified"
              value="true"
              defaultChecked={verified}
            />
            Verified
          </label>
          <button>Search</button>
        </form>
      </section>
      <section className="listing-section">
        <header>
          <div>
            <h2>Compatible with Sandbox 0.3</h2>
            <p>
              {result.items.length} signed version
              {result.items.length === 1 ? "" : "s"} in this page
            </p>
          </div>
        </header>
        {result.items.length ? (
          <div className="listing-grid">
            {result.items.map((plugin) => (
              <Link
                className="listing-card"
                href={`/marketplace/${plugin.pluginId}`}
                key={plugin.pluginId}
              >
                <div className="card-top">
                  <span className="listing-icon">
                    <Box size={20} />
                  </span>
                  <span className="version">v{plugin.version}</span>
                </div>
                <h3>{plugin.name}</h3>
                <div className="publisher">
                  {plugin.publisher.publicName}
                  {plugin.publisher.verified && (
                    <BadgeCheck size={13} aria-label="Verified publisher" />
                  )}
                </div>
                <p>{plugin.summary}</p>
                <div className="chips">
                  {plugin.categories.slice(0, 3).map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
                <footer>
                  <span>
                    <Download size={13} />
                    {compact(plugin.installCount)}
                  </span>
                  <span>
                    <Star size={13} />
                    {plugin.ratingAverage?.toFixed(1) ?? "New"}
                  </span>
                  <b>{price(plugin.pricing)}</b>
                </footer>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <Box size={28} />
            <h3>No compatible plugins</h3>
            <p>
              Adjust the search or pricing filters. Incompatible and suspended
              versions are hidden.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}
function price(pricing: Record<string, unknown>) {
  return pricing.model === "free"
    ? "Free"
    : typeof pricing.displayPrice === "string"
      ? pricing.displayPrice
      : "Paid";
}
