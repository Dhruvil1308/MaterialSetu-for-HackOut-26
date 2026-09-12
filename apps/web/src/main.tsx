import React, { useState, useEffect, useRef, FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Search,
  Package,
  ArrowUpRight,
  Plus,
  MapPin,
  ShieldCheck,
  Layers3,
  ArrowRight,
  SlidersHorizontal,
  X,
  Check,
  Upload,
  FileCheck2,
  Truck,
  Leaf,
  LayoutGrid,
  ArrowLeftRight,
  LogOut,
  Menu,
  Star,
  ChevronRight,
  RefreshCw,
  Scale,
  UserRound,
  CheckCircle2,
} from "lucide-react";
import {
  createApi,
  money,
  label,
  requestKey,
  type User,
  type Listing,
  type Material,
  type SearchResult,
  type Pool,
  type Exchange,
  type Trust,
} from "@materialsetu/shared";
import "./style.css";
const API_BASE = (import.meta as any).env.VITE_API_URL || "/api";
const api = createApi(API_BASE, () =>
  localStorage.getItem("materialsetu-token"),
);
const empty: SearchResult = {
  listings: [],
  pools: [],
  quantity: 50,
  unit: "kg",
  radius_km: 30,
  clarification: null,
  parsed: { method: "rules", material_ids: [] },
  pool_note: "",
};
type Tab = "market" | "exchanges" | "listings" | "trust" | "admin";
function App() {
  const [tab, setTab] = useState<Tab>("market"),
    [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [accounts, setAccounts] = useState<User[]>([]),
    [taxonomy, setTaxonomy] = useState<Material[]>([]),
    [data, setData] = useState<SearchResult>(empty),
    [all, setAll] = useState<Listing[]>([]),
    [exchanges, setExchanges] = useState<Exchange[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [filters, setFilters] = useState(false),
    [menu, setMenu] = useState(false);
  const [ready, setReady] = useState(false),
    [waking, setWaking] = useState(false),
    [bootError, setBootError] = useState("");
  const [query, setQuery] = useState("50 kg plastic"),
    [mat, setMat] = useState(""),
    [radius, setRadius] = useState(30),
    [unit, setUnit] = useState("kg"),
    [quantity, setQuantity] = useState(50),
    [use, setUse] = useState(""),
    [maxTransport, setMaxTransport] = useState(""),
    [maxLanded, setMaxLanded] = useState(""),
    [rate, setRate] = useState(12),
    [fee, setFee] = useState(40),
    [grade, setGrade] = useState("");
  const [modal, setModal] = useState<
      "login" | "create" | "detail" | "request" | null
    >(null),
    [selected, setSelected] = useState<Listing | null>(null),
    [profile, setProfile] = useState<
      (Trust & { business: User; reviews: any[] }) | null
    >(null),
    [request, setRequest] = useState<{
      items: { listing_id: string; quantity: number }[];
      key: string;
    } | null>(null),
    [pickup, setPickup] = useState(""),
    [trust, setTrust] = useState<any>(null),
    [pending, setPending] = useState<any>({ gst: [], evidence: [] }),
    [disputes, setDisputes] = useState<any[]>([]),
    [overview, setOverview] = useState<any>(null);
  const initialized = useRef(false),
    searchSeq = useRef(0),
    loadedFor = useRef<string | null | undefined>(undefined);
  function where(who: User | null) {
    return {
      latitude: who?.latitude ?? 23.588,
      longitude: who?.longitude ?? 72.369,
    };
  }
  async function run(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh(who: User | null = user) {
    const admin = who?.role === "admin";
    // One wave, not four: none of these depend on each other's answers.
    const [ls, ex, mine, queue, rows, view] = await Promise.all([
      api<Listing[]>("/listings"),
      who ? api<Exchange[]>("/exchanges") : Promise.resolve([]),
      who ? api(`/businesses/${who.id}/trust`) : Promise.resolve(null),
      admin ? api("/admin/evidence") : Promise.resolve(null),
      admin ? api<any[]>("/admin/disputes") : Promise.resolve(null),
      admin ? api("/admin/overview") : Promise.resolve(null),
    ]);
    setAll(ls);
    setExchanges(ex);
    setTrust(mine);
    if (queue) setPending(queue);
    if (rows) setDisputes(rows);
    if (view) setOverview(view);
  }
  async function search(who: User | null = user) {
    const seq = ++searchSeq.current;
    const result = await api<SearchResult>("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        material_id: mat,
        ...where(who),
        radius_km: radius,
        quantity,
        unit,
        use,
        grade,
        km_rate: rate,
        stop_fee: fee,
        max_transport: maxTransport === "" ? null : Number(maxTransport),
        max_unit_price: maxLanded === "" ? null : Number(maxLanded),
      }),
    });
    if (seq === searchSeq.current) setData(result);
  }
  async function boot() {
    setBootError("");
    setBusy(true);
    // A sleeping free instance can take most of a minute to answer the first
    // request. Say so rather than showing an empty marketplace.
    const slow = setTimeout(() => setWaking(true), 2500);
    try {
      // Wave one: nothing here needs anything else here.
      const token = localStorage.getItem("materialsetu-token");
      const [h, tax, me] = await Promise.all([
        api("/health"),
        api<Material[]>("/taxonomy"),
        token
          ? api<User>("/me").catch(() => {
              localStorage.removeItem("materialsetu-token");
              return null;
            })
          : Promise.resolve(null),
      ]);
      setDemo(h.demo);
      setTaxonomy(tax);
      setUser(me);
      // Wave two, all at once, using the account we just resolved rather than
      // waiting for React to hand it back.
      loadedFor.current = me?.id ?? null;
      await Promise.all([
        h.demo
          ? api<User[]>("/demo/accounts").then(setAccounts)
          : Promise.resolve(),
        search(me),
        refresh(me),
      ]);
      setReady(true);
    } catch (e) {
      const detail = (e as Error).message;
      // fetch() reports a dead or unreachable server as "Failed to fetch",
      // which means nothing to the person reading it.
      setBootError(
        /failed to fetch|network|load failed/i.test(detail)
          ? "Could not reach the exchange."
          : detail,
      );
    } finally {
      clearTimeout(slow);
      setWaking(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Claim the signed-out view before the [user] effect runs on this same mount,
    // otherwise it fetches everything a second time alongside boot.
    loadedFor.current = null;
    boot();
  }, []);
  useEffect(() => {
    // Boot already loaded this account; only act on a real change of account.
    if (!initialized.current || loadedFor.current === (user?.id ?? null)) return;
    loadedFor.current = user?.id ?? null;
    run(async () => {
      await Promise.all([refresh(), search()]);
    });
  }, [user]);
  /** Keeps you where you were, unless this account cannot go there. */
  function home(who: any, current: Tab): Tab {
    const k = who.kind ?? "both";
    const canBuy = k === "buyer" || k === "both";
    const canSell = k === "supplier" || k === "both";
    const blocked =
      (!canBuy && current === "market") ||
      (!canSell && current === "listings") ||
      (who.role !== "admin" && current === "admin");
    if (!blocked) return current;
    return who.role === "admin" ? "admin" : canBuy ? "market" : "listings";
  }
  async function signIn(result: any) {
    setExchanges([]);
    setTrust(null);
    setPending({ gst: [], evidence: [] });
    setDisputes([]);
    localStorage.setItem("materialsetu-token", result.token);
    setUser(result.user);
    setTab((current) => home(result.user, current));
    setModal(null);
    setNotice("Signed in. Your business location is used for nearby matching.");
  }
  async function showDetail(l: Listing) {
    setSelected(l);
    setModal("detail");
    setProfile(null);
    await run(async () =>
      setProfile(await api(`/businesses/${l.seller_id}/trust`)),
    );
  }
  function prepare(items: { listing_id: string; quantity: number }[]) {
    if (!user) {
      setModal("login");
      return;
    }
    setRequest({ items, key: requestKey() });
    setPickup("");
    setModal("request");
  }
  async function action(id: string, action: string, actual?: number) {
    await run(async () => {
      await api(`/exchange-items/${id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, actual }),
      });
      await refresh();
      await search();
      setNotice("Exchange updated.");
    });
  }
  // A visitor is treated as a buyer: browsing is the first thing anyone does.
  const kind = user?.kind ?? "buyer";
  const buys = !user || kind === "buyer" || kind === "both";
  const sells = !!user && (kind === "supplier" || kind === "both");
  const mine = all.filter((l) => l.seller_id === user?.id);
  const available = data.listings.reduce((sum, l) => sum + l.available, 0);
  const isOwn = selected?.seller_id === user?.id;
  if (!ready)
    return <Startup waking={waking} error={bootError} onRetry={boot} />;
  return (
    <div className="app-shell">
      {busy && (
        <div className="loadbar" role="status" aria-label="Loading">
          <span />
        </div>
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("market");
          }}
        >
          <span className="brand-icon">
            <img src="/logo-white.svg" alt="" width={23} height={21} />
          </span>
          <span>
            Material<span className="brand-light">Setu</span>
            <small>THE MATERIAL EXCHANGE</small>
          </span>
        </a>
        <div className="workspace">
          <span className="avatar">{user?.name.charAt(0) || "M"}</span>
          <div>
            <b>{user?.name || "Your business workspace"}</b>
            <small>
              {user
                ? user.role === "admin"
                  ? "Reviewer · checks GST and documents"
                  : `${user.city} · ${
                      kind === "buyer"
                        ? "buying"
                        : kind === "supplier"
                          ? "supplying"
                          : "buying and supplying"
                    }`
                : "Mehsana, Gujarat"}
            </small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {(
            [
              ...(sells ? [["listings", Package, "My listings"]] : []),
              ...(buys ? [["market", LayoutGrid, "Find materials"]] : []),
              [
                "exchanges",
                ArrowLeftRight,
                sells && !buys ? "Requests" : "Exchanges",
              ],
              ["trust", ShieldCheck, "Trust & verification"],
              ...(user?.role === "admin"
                ? [["admin", FileCheck2, "Review centre"]]
                : []),
            ] as any[]
          ).map(([id, Icon, title]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setMenu(false);
              }}
            >
              <Icon size={19} />
              {title}
              {id === "exchanges" &&
                exchanges.some((e) =>
                  e.items.some((i) => i.status === "pending"),
                ) && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Leaf size={24} />
          <b>
            Good materials deserve
            <br />
            another beginning.
          </b>
          <p>
            Trade locally. Share surplus.
            <br />
            Keep useful resources in use.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span className="avatar small">
            <UserRound size={17} />
          </span>
          <span>{user ? "Business account" : "Explore the exchange"}</span>
          <button
            className="icon-button"
            aria-label={user ? "Sign out" : "Sign in"}
            onClick={() =>
              user
                ? run(async () => {
                    await api("/auth/logout", { method: "POST" });
                    localStorage.removeItem("materialsetu-token");
                    setUser(null);
                    setTab("market");
                  })
                : setModal("login")
            }
          >
            {user ? <LogOut size={18} /> : <ArrowRight size={18} />}
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <b>
              {
                {
                  market: "Find materials",
                  exchanges: "Exchanges",
                  listings: "My listings",
                  trust: "Trust & verification",
                  admin: "Review centre",
                }[tab]
              }
            </b>
          </span>
          <div className="header-actions">
            <span className="location">
              <MapPin size={16} />
              {user?.city || "Mehsana"}
            </span>
            {!user && (
              <button className="quiet" onClick={() => setModal("login")}>
                Sign in
              </button>
            )}
            <button
              className="primary"
              onClick={() => setModal(user ? "create" : "login")}
            >
              <Plus size={17} /> List material
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-bar">
            <span>
              <b>Demo workspace</b> · Fictional businesses, evidence and
              reviews.
            </span>
            <label>
              Explore as{" "}
              <select
                value={user?.id || ""}
                disabled={busy}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id)
                    run(async () =>
                      signIn(
                        await api("/auth/demo", {
                          method: "POST",
                          body: JSON.stringify({ business_id: id }),
                        }),
                      ),
                    );
                }}
              >
                <option value="">Not signed in</option>
                <optgroup label="Businesses — can buy and sell">
                  {accounts
                    .filter((a) => a.role !== "admin")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.city}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Platform">
                  {accounts
                    .filter((a) => a.role === "admin")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · reviewer
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
          </div>
        )}
        <div className="content">
          {error && (
            <div role="alert" className="alert error">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "market" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">LOCAL SUPPLY. NEW POSSIBILITIES.</p>
                  <h1>
                    The right material.
                    <br />
                    <span>Closer than you think.</span>
                  </h1>
                  <p>
                    Find surplus packaging, compare evidence and combine nearby
                    supply.
                  </p>
                </div>
                <div className="circle-mark">
                  <Layers3 size={45} />
                  <span>
                    CIRCULATE
                    <br />
                    MORE VALUE
                  </span>
                </div>
              </div>
              <form
                className="search-panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(search);
                }}
              >
                <div className="search-line">
                  <Search size={23} />
                  <input
                    aria-label="Describe material demand"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setMat("");
                    }}
                    placeholder="Try 50 kg plastic or 10 wooden pallets"
                  />
                  <button className="primary" disabled={busy}>
                    {busy ? "Searching…" : "Find materials"}
                    {busy ? <span className="spinner" /> : <ArrowRight size={17} />}
                  </button>
                </div>
                <div className="search-options">
                  <span>
                    <MapPin size={15} />
                    {user?.city || "Mehsana"} · within{" "}
                    <select
                      aria-label="Search radius"
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                    >
                      {[5, 10, 20, 30, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n} km
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="divider" />
                  <span>
                    <ShieldCheck size={15} />
                    Evidence-based trust
                  </span>
                  <button
                    className="filter-button"
                    type="button"
                    onClick={() => setFilters(!filters)}
                  >
                    <SlidersHorizontal size={16} />
                    Filters & transport
                  </button>
                </div>
                {filters && (
                  <div className="filters">
                    <Field label="Material">
                      <select
                        value={mat}
                        onChange={(e) => {
                          setMat(e.target.value);
                          setQuery("");
                          setUnit(
                            taxonomy.find((m) => m.id === e.target.value)
                              ?.unit || "kg",
                          );
                        }}
                      >
                        <option value="">All compatible categories</option>
                        {taxonomy.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Required quantity">
                      <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => {
                          setQuantity(+e.target.value);
                          setQuery("");
                        }}
                      />
                    </Field>
                    <Field label="Unit">
                      <select
                        value={unit}
                        onChange={(e) => {
                          setUnit(e.target.value);
                          setQuery("");
                        }}
                      >
                        <option value="kg">kg</option>
                        <option value="piece">pieces</option>
                      </select>
                    </Field>
                    <Field label="Potential use">
                      <input
                        value={use}
                        onChange={(e) => setUse(e.target.value)}
                        placeholder="e.g. Paper recycling"
                      />
                    </Field>
                    <Field label="Condition">
                      <select
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                      >
                        <option value="">Any declared condition</option>
                        <option value="clean_sorted">Clean & sorted</option>
                        <option value="used_sorted">Used & sorted</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </Field>
                    <Field label="Max transport (₹)">
                      <input
                        type="number"
                        min="0"
                        value={maxTransport}
                        onChange={(e) => setMaxTransport(e.target.value)}
                        placeholder="No limit"
                      />
                    </Field>
                    <Field label="Max landed cost / unit (₹)">
                      <input
                        type="number"
                        min="0"
                        value={maxLanded}
                        onChange={(e) => setMaxLanded(e.target.value)}
                        placeholder="No limit"
                      />
                    </Field>
                    <Field label="Transport estimate ₹ / km">
                      <input
                        type="number"
                        min="0"
                        value={rate}
                        onChange={(e) => setRate(+e.target.value)}
                      />
                    </Field>
                    <Field label="Loading estimate ₹ / stop">
                      <input
                        type="number"
                        min="0"
                        value={fee}
                        onChange={(e) => setFee(+e.target.value)}
                      />
                    </Field>
                    <p className="full muted">
                      Text quantities override the quantity field. Radius uses
                      straight-line distance. Transport prices are editable
                      assumptions, not quotes.
                    </p>
                  </div>
                )}
              </form>
              <div className="category-row">
                {[{ id: "", name: "All materials" }, ...taxonomy].map((m) => (
                  <button
                    key={m.id}
                    className={mat === m.id ? "selected" : ""}
                    onClick={() => {
                      setMat(m.id);
                      setQuery("");
                      if (m.id)
                        setUnit(
                          taxonomy.find((t) => t.id === m.id)?.unit || "kg",
                        );
                    }}
                  >
                    {m.name}
                  </button>
                ))}
                <button
                  className="apply"
                  disabled={busy}
                  onClick={() => run(search)}
                >
                  Apply <ArrowRight size={14} />
                </button>
              </div>
              <div className="market-layout">
                <section>
                  <div className="section-heading">
                    <div>
                      <h2>
                        Available around you{" "}
                        <span className="count">{data.listings.length}</span>
                      </h2>
                      <p>
                        {data.clarification ||
                          `${available.toLocaleString("en-IN")} ${data.unit} available · ${data.radius_km} km search radius`}
                      </p>
                    </div>
                    <span className="sort-label">Nearest first</span>
                  </div>
                  {busy ? (
                    <div className="listing-grid">
                      {[0, 1, 2, 3].map((i) => (
                        <SkeletonCard key={i} />
                      ))}
                    </div>
                  ) : !data.listings.length ? (
                    <Empty
                      title={
                        all.length
                          ? "No materials found nearby"
                          : "Nothing listed yet"
                      }
                      text={
                        all.length
                          ? data.clarification ||
                            "Try another material, a wider radius or a different intended use."
                          : "The exchange is new. List your own surplus and buyers nearby will find it."
                      }
                      action={
                        all.length
                          ? null
                          : user
                            ? sells
                              ? { label: "List material", run: () => setTab("listings") }
                              : {
                                  label: "I have surplus too",
                                  run: () => setTab("trust"),
                                }
                            : { label: "Create an account", run: () => setModal("login") }
                      }
                    />
                  ) : (
                    <div className="listing-grid">
                      {data.listings.map((l) => (
                        <ListingCard
                          key={l.id}
                          l={l}
                          onClick={() => showDetail(l)}
                        />
                      ))}
                    </div>
                  )}
                </section>
                <aside className="pool-column">
                  <div className="pool-intro">
                    <span className="pill">
                      <Layers3 size={14} />
                      SUPPLY POOLING
                    </span>
                    <h2>
                      A little from each.
                      <br />
                      Enough for you.
                    </h2>
                    <p>
                      Combine compatible materials from nearby businesses to
                      meet your demand.
                    </p>
                    <div className="demand">
                      <span>You need</span>
                      <strong>
                        {data.quantity} <small>{data.unit}</small>
                      </strong>
                    </div>
                  </div>
                  {data.pools.length ? (
                    data.pools.slice(0, 3).map((p, i) => (
                      <PoolCard
                        key={i}
                        pool={p}
                        name={
                          taxonomy.find((m) => m.id === p.material_id)?.name ||
                          p.material_id
                        }
                        index={i}
                        onRequest={() =>
                          prepare(
                            p.items.map((l) => ({
                              listing_id: l.id,
                              quantity: l.take,
                            })),
                          )
                        }
                      />
                    ))
                  ) : (
                    <div className="pool-empty">
                      <Layers3 size={25} />
                      <b>No complete plan fits yet</b>
                      <p>
                        Try increasing the radius or budget. Different plastic
                        types and grades are never mixed into one pool.
                      </p>
                    </div>
                  )}
                  <p className="micro">
                    Estimates include a round trip and loading. Each supplier
                    must accept separately; a plan is ready only when every item
                    is accepted.
                  </p>
                </aside>
              </div>
            </>
          )}
          {tab === "listings" && (
            <>
              <Title
                eyebrow="YOUR SUPPLY"
                title="Turn surplus into opportunity."
                subtitle="Manage your material listings and supporting evidence."
              />
              {!user ? (
                <SignIn onClick={() => setModal("login")} />
              ) : (
                <>
                  <div className="section-heading">
                    <h2>{mine.length} listings</h2>
                    <button
                      className="primary"
                      onClick={() => setModal("create")}
                    >
                      <Plus size={16} />
                      Add a listing
                    </button>
                  </div>
                  {mine.length ? (
                    <div className="listing-grid own">
                      {mine.map((l) => (
                        <ListingCard
                          key={l.id}
                          l={l}
                          onClick={() => showDetail(l)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Your next listing starts here"
                      text="Add material details, then attach photographs and a weighing slip for review."
                    />
                  )}
                </>
              )}
            </>
          )}
          {tab === "exchanges" && (
            <>
              <Title
                eyebrow="MOVE MATERIALS FORWARD"
                title="Every exchange, in one place."
                subtitle="Track requests, supplier acceptance and confirmed handovers."
              />
              {!user ? (
                <SignIn onClick={() => setModal("login")} />
              ) : (
                <>
                  {exchanges.length === 0 && (
                    <Empty
                      title="No exchanges yet"
                      text="Find a listing or a supply pool and send your first request."
                    />
                  )}
                  {exchanges.map((e) => (
                    <div key={e.id} className="exchange">
                      <div className="exchange-heading">
                        <div>
                          <b>
                            {e.pooled ? "Pooled exchange" : "Material exchange"}{" "}
                            <span className="mono">#{e.id.slice(0, 8)}</span>
                          </b>
                          <p>
                            {e.buyer_id === user.id
                              ? "You are buying"
                              : `Buyer: ${e.buyer_name}`}{" "}
                            · {new Date(e.created * 1000).toLocaleDateString()}
                          </p>
                        </div>
                        <span className="pill neutral">
                          {e.all_confirmed
                            ? "All suppliers accepted"
                            : "Check item statuses"}
                        </span>
                      </div>
                      <p className="pickup">
                        <Truck size={16} />
                        {e.pickup}
                      </p>
                      {e.items.map((i) => (
                        <ExchangeRow
                          key={i.id}
                          item={i}
                          buyer={e.buyer_id === user.id}
                          busy={busy}
                          onAction={action}
                          onReview={(rating: number, comment: string) =>
                            run(async () => {
                              await api("/reviews", {
                                method: "POST",
                                body: JSON.stringify({
                                  item_id: i.id,
                                  rating,
                                  comment,
                                }),
                              });
                              await refresh();
                              setNotice(
                                "Your completed-exchange review was saved.",
                              );
                            })
                          }
                        />
                      ))}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {tab === "trust" && (
            <>
              <Title
                eyebrow="CONFIDENCE THROUGH EVIDENCE"
                title="Trust you can understand."
                subtitle="Your score reflects reviewed documents and completed exchanges."
              />
              {!user ? (
                <SignIn onClick={() => setModal("login")} />
              ) : (
                <div className="trust-layout">
                  <section className="panel">
                    <h2>What you use MaterialSetu for</h2>
                    <p>
                      This decides what you see. Change it whenever your
                      business does.
                    </p>
                    <div className="kind-choice" role="radiogroup">
                      {KINDS.map((k) => (
                        <button
                          key={k.id}
                          type="button"
                          role="radio"
                          aria-checked={kind === k.id}
                          disabled={busy || user.role === "admin"}
                          className={kind === k.id ? "selected" : ""}
                          onClick={() =>
                            run(async () => {
                              await api("/me/kind", {
                                method: "POST",
                                body: JSON.stringify({ kind: k.id }),
                              });
                              setUser(await api("/me"));
                              setNotice(`Your account is set to: ${k.title}.`);
                            })
                          }
                        >
                          <k.icon size={19} />
                          <b>{k.title}</b>
                          <span>{k.blurb}</span>
                        </button>
                      ))}
                    </div>
                    {user.role === "admin" && (
                      <p className="muted">
                        Reviewer accounts check evidence and do not trade.
                      </p>
                    )}
                  </section>
                  <section className="panel">
                    {trust && <TrustPanel trust={trust} />}
                    <p className="muted">
                      A low score may simply mean a new business has little
                      history. It is not a finding of dishonesty.
                    </p>
                  </section>
                  <section className="panel">
                    <h2>GST details</h2>
                    <p>
                      Submit your GSTIN for manual review. A valid format alone
                      does not verify registration.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run(async () => {
                          await api("/me/gst", {
                            method: "POST",
                            body: JSON.stringify({ gstin: f.get("gstin") }),
                          });
                          setUser(await api("/me"));
                          setNotice("GST details submitted for manual review.");
                        });
                      }}
                    >
                      <Field label="GSTIN">
                        <input
                          name="gstin"
                          required
                          maxLength={15}
                          defaultValue={user.gstin}
                          placeholder="15-character GSTIN"
                        />
                      </Field>
                      <p className="pill neutral">
                        Status: {label(user.gst_status)}
                      </p>
                      <button disabled={busy} className="primary">
                        Submit GST details
                      </button>
                    </form>
                    <h3>Supporting GST document</h3>
                    <UploadForm
                      kind="gst_document"
                      onDone={() =>
                        run(async () => {
                          await refresh();
                          setNotice(
                            "Document uploaded. A reviewer will check it.",
                          );
                        })
                      }
                      onError={setError}
                    />
                    <h3>Build your evidence</h3>
                    <p>
                      Add material photographs and weighing slips from each
                      listing. Files earn score points only after review.
                    </p>
                    <button
                      className="outline"
                      onClick={() => setTab("listings")}
                    >
                      Open my listings <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
              )}
            </>
          )}
          {tab === "admin" && user?.role === "admin" && (
            <>
              <Title
                eyebrow="REVIEW CENTRE"
                title="Nothing counts until a person checks it."
                subtitle="Approve GST details and documents, settle disputes, and see the whole register."
              />
              {overview && (
                <div className="admin-stats">
                  {[
                    ["Awaiting GST review", overview.counts.pending_gst, true],
                    ["Documents to check", overview.counts.pending_evidence, true],
                    ["Open disputes", overview.counts.open_disputes, true],
                    ["Registered businesses", overview.counts.businesses, false],
                    ["Live listings", overview.counts.listings, false],
                    ["Completed handovers", overview.counts.completed_exchanges, false],
                  ].map(([label, n, actionable]: any) => (
                    <div
                      key={label}
                      className={`admin-stat ${actionable && n > 0 ? "needs" : ""}`}
                    >
                      <strong>{n}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
              <h2 className="admin-heading">
                Waiting for you
                {pending.gst.length + pending.evidence.length > 0 && (
                  <span className="count">
                    {pending.gst.length + pending.evidence.length}
                  </span>
                )}
              </h2>
              <div className="admin-grid">
                {pending.gst.map((g: any) => (
                  <ReviewCard
                    key={g.id}
                    kind="GST details"
                    title={g.name}
                    subtitle={g.gstin}
                    note="A correctly shaped GSTIN is not a registered one. Check the certificate before approving."
                    onDecide={(approved: boolean, reference: string) =>
                      run(async () => {
                        await api(`/admin/gst/${g.id}`, {
                          method: "POST",
                          body: JSON.stringify({ approved, reference }),
                        });
                        await refresh();
                      })
                    }
                  />
                ))}
                {pending.evidence.map((e: any) => (
                  <ReviewCard
                    key={e.id}
                    kind={label(e.kind)}
                    title={e.business}
                    subtitle={e.listing_id ? `Listing ${e.listing_id.slice(0, 8)}` : "Account document"}
                    note="Download it, look at it, then write what you checked."
                    onOpen={() =>
                      run(async () => {
                        const res = await fetch(
                          API_BASE + `/evidence/${e.id}`,
                          {
                            headers: {
                              Authorization: `Bearer ${localStorage.getItem("materialsetu-token")}`,
                            },
                          },
                        );
                        if (!res.ok)
                          throw new Error("Unable to open evidence.");
                        const url = URL.createObjectURL(await res.blob());
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `evidence-${e.id}`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                    onDecide={(approved: boolean, reference: string) =>
                      run(async () => {
                        await api(`/admin/evidence/${e.id}`, {
                          method: "POST",
                          body: JSON.stringify({ approved, reference }),
                        });
                        await refresh();
                      })
                    }
                  />
                ))}
                {!pending.gst.length && !pending.evidence.length && (
                  <Empty
                    title="Review queue is clear"
                    text="New GST submissions and uploaded documents will appear here."
                  />
                )}
              </div>
              <h2 className="admin-heading">
                Disputed handovers
                {disputes.length > 0 && <span className="count">{disputes.length}</span>}
              </h2>
              {!disputes.length && (
                <p className="muted">No handover is currently in dispute.</p>
              )}
              {disputes.map((d) => (
                <form
                  className="panel"
                  key={d.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await api(`/admin/disputes/${d.id}`, {
                        method: "POST",
                        body: JSON.stringify({
                          actual: Number(f.get("actual")),
                          reference: f.get("reference"),
                        }),
                      });
                      await refresh();
                    });
                  }}
                >
                  <h3>{d.title}</h3>
                  <p>
                    {d.buyer} ↔ {d.seller} · Agreed {d.quantity}
                  </p>
                  <Field label="Actual transferred quantity">
                    <input
                      name="actual"
                      type="number"
                      min="0"
                      max={d.quantity}
                      step="0.001"
                      required
                    />
                  </Field>
                  <Field label="Resolution reference">
                    <input name="reference" required minLength={8} />
                  </Field>
                  <button className="primary">
                    Resolve and reconcile stock
                  </button>
                </form>
              ))}
              {overview && (
                <>
                  <h2 className="admin-heading">Registered businesses</h2>
                  <div className="table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Business</th>
                          <th>Place</th>
                          <th>GST</th>
                          <th>Listings</th>
                          <th>Handovers</th>
                          <th>Trust</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.businesses.map((b: any) => (
                          <tr key={b.id}>
                            <td>
                              <b>{b.name}</b>
                              {b.role === "admin" && (
                                <span className="role-tag">reviewer</span>
                              )}
                              {b.is_demo && <span className="role-tag demo">demo</span>}
                            </td>
                            <td>{b.city}</td>
                            <td>
                              <span className={`gst ${b.gst_status}`}>
                                {label(b.gst_status)}
                              </span>
                              {b.gstin && <small className="mono">{b.gstin}</small>}
                              {b.gst_reference && (
                                <small title={b.gst_reference}>{b.gst_reference}</small>
                              )}
                            </td>
                            <td>{b.listings}</td>
                            <td>{b.completed}</td>
                            <td>{b.trust}/100</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h2 className="admin-heading">Recent decisions</h2>
                  {!overview.decided.length ? (
                    <p className="muted">Nothing has been reviewed yet.</p>
                  ) : (
                    <ul className="decisions">
                      {overview.decided.map((d: any) => (
                        <li key={d.id}>
                          <span className={`gst ${d.status}`}>{d.status}</span>
                          <b>{d.business}</b>
                          <span className="muted">{label(d.kind)}</span>
                          <span className="reason">{d.reference}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
          <footer>
            MaterialSetu{" "}
            <span>Connecting local businesses. Keeping materials in use.</span>
            <span>Tech Titans · Ganpat University</span>
          </footer>
        </div>
      </main>
      {modal && (
        <Modal
          title={
            {
              login: "Your business workspace",
              create: "List surplus material",
              detail: selected?.title || "Material details",
              request: "Send an exchange request",
            }[modal]
          }
          onClose={() => setModal(null)}
        >
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="alert success">
              {notice}
            </div>
          )}
          {modal === "login" && (
            <LoginForm
              busy={busy}
              submit={(path: string, body: unknown) =>
                run(async () =>
                  signIn(
                    await api(path, {
                      method: "POST",
                      body: JSON.stringify(body),
                    }),
                  ),
                )
              }
            />
          )}
          {modal === "create" && (
            <CreateForm
              taxonomy={taxonomy}
              busy={busy}
              onClassify={(text: string) =>
                api("/classify", {
                  method: "POST",
                  body: JSON.stringify({ text }),
                })
              }
              onClassifyImage={(body: FormData) =>
                api("/classify/image", { method: "POST", body })
              }
              onSubmit={(body: unknown) =>
                run(async () => {
                  const l = await api<Listing>("/listings", {
                    method: "POST",
                    body: JSON.stringify(body),
                  });
                  await refresh();
                  await search();
                  setSelected(l);
                  setModal("detail");
                  setNotice(
                    "Listing published. Add evidence below to support it.",
                  );
                  setProfile(await api(`/businesses/${l.seller_id}/trust`));
                })
              }
            />
          )}
          {modal === "detail" && selected && (
            <>
              <div className="detail-top">
                <span className="material-symbol">
                  {selected.material_id.toUpperCase().slice(0, 4)}
                </span>
                <div>
                  <span className="eyebrow">
                    {selected.material.category} · {label(selected.intent)}
                  </span>
                  <h2>{selected.seller.name}</h2>
                  <p>
                    <MapPin size={15} />
                    {selected.seller.city}{" "}
                    {selected.distance_km !== null
                      ? `· ${selected.distance_km} km away`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="detail-numbers">
                <div>
                  <span>Available</span>
                  <strong>
                    {selected.available} {selected.unit}
                  </strong>
                </div>
                <div>
                  <span>Material price</span>
                  <strong>
                    {money(selected.price)} / {selected.unit}
                  </strong>
                </div>
                <div>
                  <span>Condition</span>
                  <strong>{label(selected.grade)}</strong>
                </div>
              </div>
              <p>{selected.description}</p>
              {selected.dimensions && <p>Dimensions: {selected.dimensions}</p>}
              <h3>Potential uses</h3>
              <div className="tags">
                {selected.material.uses.map((u) => (
                  <span key={u}>{u}</span>
                ))}
              </div>
              <p className="muted">{selected.material.note}</p>
              <h3>Listing evidence</h3>
              <div className="photo-gallery">
                {selected.evidence
                  .filter((e) => e.kind === "photo")
                  .map((e) => (
                    <figure key={e.id}>
                      <img
                        src={`${API_BASE}/evidence/${e.id}`}
                        alt={`Material photograph provided by ${selected.seller.name}`}
                        loading="lazy"
                      />
                      <figcaption>
                        Supplier photo · {e.status}
                        {selected.seller.is_demo ? " · Demonstration only" : ""}
                      </figcaption>
                    </figure>
                  ))}
              </div>
              {selected.evidence.length ? (
                <div className="evidence-list">
                  {selected.evidence.map((e) => (
                    <span key={e.id}>
                      <FileCheck2 size={16} />
                      {label(e.kind)} <b>{e.status}</b>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">No evidence uploaded yet.</p>
              )}
              {isOwn && (
                <>
                  <h3>Add evidence</h3>
                  <UploadForm
                    listingId={selected.id}
                    onDone={() =>
                      run(async () => {
                        const ls = await api<Listing[]>("/listings");
                        setAll(ls);
                        setSelected(
                          ls.find((l) => l.id === selected.id) || selected,
                        );
                        setProfile(
                          await api(`/businesses/${selected.seller_id}/trust`),
                        );
                        setNotice("Evidence uploaded for review.");
                      })
                    }
                    onError={setError}
                  />
                </>
              )}
              {profile && (
                <>
                  <h3>Supplier trust</h3>
                  <TrustPanel trust={profile} />
                  {profile.reviews.slice(0, 3).map((r: any, i: number) => (
                    <p key={i} className="review">
                      <Star size={14} />
                      <b>{r.rating}/5</b> {r.comment}
                    </p>
                  ))}
                </>
              )}
              {!isOwn && (
                <form
                  className="request-inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    prepare([
                      {
                        listing_id: selected.id,
                        quantity: Number(f.get("quantity")),
                      },
                    ]);
                  }}
                >
                  <Field label={`Quantity (${selected.unit})`}>
                    <input
                      type="number"
                      name="quantity"
                      min={selected.unit === "piece" ? 1 : 0.001}
                      step={selected.unit === "piece" ? 1 : 0.001}
                      max={selected.available}
                      defaultValue={Math.min(data.quantity, selected.available)}
                      required
                    />
                  </Field>
                  <button
                    disabled={selected.available === 0}
                    className="primary"
                  >
                    Request material <ArrowRight size={16} />
                  </button>
                </form>
              )}
            </>
          )}
          {modal === "request" && request && (
            <>
              <p>
                Suppliers review each request before stock is reserved. For a
                pool, wait for every supplier to accept before arranging
                collection.
              </p>
              <div className="request-summary">
                {request.items.map((i) => (
                  <p key={i.listing_id}>
                    <Package size={18} />
                    {all.find((l) => l.id === i.listing_id)?.title ||
                      i.listing_id}
                    <b>
                      {i.quantity}{" "}
                      {all.find((l) => l.id === i.listing_id)?.unit}
                    </b>
                  </p>
                ))}
              </div>
              <Field label="Proposed pickup arrangements">
                <textarea
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                  placeholder="Suggested date, time and collection instructions"
                  maxLength={300}
                />
              </Field>
              <p className="muted">
                Distance checks use your business location: {user?.city}.
                Transport estimates are not bookings or guaranteed prices.
              </p>
              <button
                className="primary full"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/exchanges", {
                      method: "POST",
                      body: JSON.stringify({
                        items: request.items,
                        idempotency_key: request.key,
                        pickup: pickup || "Arrange pickup with supplier",
                        radius_km: data.radius_km || radius,
                      }),
                    });
                    setModal(null);
                    setTab("exchanges");
                    await refresh();
                    setNotice("Request sent. Waiting for supplier acceptance.");
                  })
                }
              >
                {busy ? "Sending…" : "Send request"}
                {busy ? <span className="spinner" /> : <ArrowUpRight size={17} />}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function Field({
  label: txt,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{txt}</span>
      {children}
    </label>
  );
}
function Title({ eyebrow, title, subtitle }: any) {
  return (
    <div className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}
function Empty({ title, text, action }: any) {
  return (
    <div className="empty">
      <Package size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="primary" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
function SignIn({ onClick }: any) {
  return (
    <div className="empty">
      <UserRound size={32} />
      <h3>Your business, connected.</h3>
      <p>Sign in to manage materials, requests and evidence.</p>
      <button className="primary" onClick={onClick}>
        Sign in or register
      </button>
    </div>
  );
}
function ListingCard({ l, onClick }: { l: Listing; onClick: () => void }) {
  return (
    <button className="listing-card" onClick={onClick}>
      <div className={`material-banner ${l.material.category.toLowerCase()}`}>
        <span className="material-code">{l.material_id.toUpperCase()}</span>
        <span className="material-caption">
          {l.material.category}
          <br />
          {label(l.intent)}
        </span>
        <span className="distance">
          <MapPin size={12} />
          {l.distance_km === null ? l.seller.city : `${l.distance_km} km`}
        </span>
      </div>
      <div className="listing-body">
        <div className="listing-meta">
          <span>{label(l.grade)}</span>
          <span
            className={`trust-badge ${l.trust.completed ? "" : "untested"}`}
            title={
              l.trust.completed
                ? `${l.trust.completed} confirmed handovers`
                : "No completed exchanges yet. A low score means little evidence so far, not a bad supplier."
            }
          >
            <ShieldCheck size={13} />
            {l.trust.score}/100
            {!l.trust.completed && <small>new</small>}
          </span>
        </div>
        <h3>{l.title}</h3>
        <p className="seller">
          {l.seller.name}
          {l.seller.gst_status === "reviewed" && <CheckCircle2 size={13} />}
        </p>
        <div className="listing-price">
          <strong>
            {money(l.price)}
            <small>/{l.unit}</small>
          </strong>
          <span>
            {l.available} {l.unit} available
          </span>
        </div>
        <div className="listing-bottom">
          <span>
            {l.evidence.filter((e) => e.status === "approved").length} reviewed
            evidence files
          </span>
          <ArrowUpRight size={18} />
        </div>
      </div>
    </button>
  );
}
function PoolCard({ pool: p, name, index, onRequest }: any) {
  return (
    <div className="pool-card">
      <div className="pool-card-header">
        <span className="pill neutral">
          {index === 0 ? "Lowest estimate" : `Option ${index + 1}`}
        </span>
        <b>
          {p.supplier_count} {p.supplier_count === 1 ? "supplier" : "suppliers"}
        </b>
      </div>
      <h3>{name}</h3>
      <p className="muted">
        {label(p.grade)} · {label(p.intent)}
      </p>
      <div className="pool-sources">
        {p.items.map((l: any, i: number) => (
          <div key={l.id}>
            <span className="step">{i + 1}</span>
            <span>
              {l.seller.name}
              <small>{l.distance_km} km away</small>
            </span>
            <b>
              {l.take} {l.unit}
            </b>
          </div>
        ))}
      </div>
      <dl>
        <div>
          <dt>Materials</dt>
          <dd>{money(p.material_cost)}</dd>
        </div>
        <div>
          <dt>Transport estimate</dt>
          <dd>{money(p.transport_cost)}</dd>
        </div>
        <div className="total">
          <dt>Estimated total</dt>
          <dd>{money(p.total_cost)}</dd>
        </div>
      </dl>
      <p className="route">
        <Truck size={14} />
        {p.estimated_route_km} km estimated round trip
      </p>
      <button className="outline full" onClick={onRequest}>
        Request this supply <ArrowRight size={16} />
      </button>
    </div>
  );
}
function TrustPanel({ trust: t }: { trust: Trust }) {
  return (
    <div className="trust-panel">
      <div className="trust-total">
        <span className="score-ring">
          {t.score}
          <small>/ 100</small>
        </span>
        <div>
          <h2>Evidence score</h2>
          <p>
            {t.is_demo
              ? "Simulated demo evidence"
              : t.completed
                ? `${t.completed} confirmed handovers`
                : "Building a track record"}
          </p>
        </div>
      </div>
      {t.parts.map((p) => (
        <div className="trust-part" key={p.label}>
          <div>
            <b>{p.label}</b>
            <span>
              {p.points} / {p.max}
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${(p.points / p.max) * 100}%` }} />
          </div>
          <small>{p.detail}</small>
        </div>
      ))}
      <p className="micro">{t.note}</p>
    </div>
  );
}
function Modal({ title, children, onClose }: any) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
const KINDS = [
  {
    id: "supplier",
    icon: Package,
    title: "We generate surplus",
    blurb: "List the packaging material your work leaves behind.",
  },
  {
    id: "buyer",
    icon: Search,
    title: "We collect material",
    blurb: "Find surplus nearby and combine it into one collection.",
  },
  {
    id: "both",
    icon: ArrowLeftRight,
    title: "Both",
    blurb: "We generate surplus and collect what we need.",
  },
];
function LoginForm({ submit, busy }: any) {
  const [register, setRegister] = useState(false);
  const [kind, setKind] = useState("both");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        submit(
          register ? "/auth/register" : "/auth/login",
          register
            ? {
                ...d,
                kind,
                latitude: Number(d.latitude),
                longitude: Number(d.longitude),
              }
            : d,
        );
      }}
    >
      <p>
        {register
          ? "Tell us what you came here to do. You can change it later."
          : "Welcome back. Sign in to your business account."}
      </p>
      {register && (
        <>
          <div className="kind-choice" role="radiogroup" aria-label="Account type">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={kind === k.id ? "selected" : ""}
                onClick={() => setKind(k.id)}
              >
                <k.icon size={19} />
                <b>{k.title}</b>
                <span>{k.blurb}</span>
              </button>
            ))}
          </div>
          <Field label="Business name">
            <input name="name" required minLength={2} />
          </Field>
          <Field label="City">
            <input name="city" required defaultValue="Mehsana" />
          </Field>
          <div className="form-grid">
            <Field label="Business latitude">
              <input
                name="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                required
                defaultValue="23.588"
              />
            </Field>
            <Field label="Business longitude">
              <input
                name="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                required
                defaultValue="72.369"
              />
            </Field>
          </div>
        </>
      )}
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <input
          name="password"
          type="password"
          minLength={register ? 10 : 1}
          autoComplete={register ? "new-password" : "current-password"}
          required
        />
      </Field>
      <button className="primary full" disabled={busy}>
        {register ? "Create account" : "Sign in"}
      </button>
      <button
        className="text-button full"
        type="button"
        onClick={() => setRegister(!register)}
      >
        {register
          ? "Already registered? Sign in"
          : "New to MaterialSetu? Create account"}
      </button>
    </form>
  );
}
function CreateForm({
  taxonomy,
  busy,
  onSubmit,
  onClassify,
  onClassifyImage,
}: any) {
  const [text, setText] = useState(""),
    [mid, setMid] = useState("pet"),
    [suggestion, setSuggestion] = useState(""),
    [looking, setLooking] = useState(false);
  async function fromPhoto(file: File) {
    setLooking(true);
    setSuggestion("Looking at the photograph…");
    try {
      const body = new FormData();
      body.set("file", file);
      const r = await onClassifyImage(body);
      if (!r.suggestions.length) {
        setSuggestion(
          `${r.observed} No catalogue category recognised — choose one below.`,
        );
        return;
      }
      setMid(r.suggestions[0].id);
      setSuggestion(
        `${r.observed} Suggested: ${r.suggestions
          .map((x: any) => x.name)
          .join(", ")} (${r.confidence} confidence). ${r.check}`,
      );
    } catch (e) {
      setSuggestion(
        (e as Error).message ||
          "Photo suggestions are unavailable. Choose a category manually.",
      );
    } finally {
      setLooking(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.currentTarget));
        onSubmit({
          ...d,
          material_id: mid,
          quantity: Number(d.quantity),
          price: Number(d.price),
        });
      }}
    >
      <Field label="Describe your material">
        <textarea
          name="description"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Clean PET bottle flakes, sorted after production"
        />
      </Field>
      <button
        className="outline"
        type="button"
        onClick={async () => {
          try {
            const r = await onClassify(text);
            setSuggestion(
              r.suggestions.length
                ? `Suggested: ${r.suggestions.map((x: any) => x.name).join(", ")}. Confirm below.`
                : "No clear category found. Choose one below.",
            );
            if (r.suggestions.length === 1) setMid(r.suggestions[0].id);
          } catch {
            setSuggestion(
              "Suggestions unavailable. Choose a category manually.",
            );
          }
        }}
      >
        <Layers3 size={16} />
        Suggest from description
      </button>
      <Field label="Or photograph the material">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={looking}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) fromPhoto(file);
          }}
        />
      </Field>
      {suggestion && (
        <p role="status" className="suggestion">
          {suggestion}
        </p>
      )}
      <p className="micro">
        Suggestions only. A photograph cannot identify a polymer — confirm the
        resin, previous contents and condition yourself. The category you
        publish is the one selected below.
      </p>
      <Field label="Listing title">
        <input name="title" required minLength={4} maxLength={140} />
      </Field>
      <div className="form-grid">
        <Field label="Confirmed material">
          <select value={mid} onChange={(e) => setMid(e.target.value)}>
            {taxonomy.map((m: Material) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Intended destination">
          <select name="intent">
            <option value="recycle">Recycling</option>
            <option value="reuse">Reuse</option>
          </select>
        </Field>
        <Field label="Condition">
          <select name="grade">
            <option value="clean_sorted">Clean and sorted</option>
            <option value="used_sorted">Used and sorted</option>
            <option value="mixed">Mixed</option>
          </select>
        </Field>
        <Field
          label={`Quantity (${taxonomy.find((m: Material) => m.id === mid)?.unit})`}
        >
          <input
            name="quantity"
            type="number"
            min="0.001"
            step={mid === "pallet" ? 1 : 0.001}
            required
          />
        </Field>
        <Field label="Price per unit (₹)">
          <input name="price" type="number" min="0" step="0.01" required />
          <small>Enter 0 to offer for free.</small>
        </Field>
        <Field label="Dimensions if relevant">
          <input name="dimensions" placeholder="Length × width × height" />
        </Field>
      </div>
      <button className="primary full" disabled={busy}>
        {busy ? "Publishing…" : "Publish listing"}
        {busy ? <span className="spinner" /> : <ArrowUpRight size={16} />}
      </button>
      <p className="micro">
        Add photos and weighing slips after publishing. Your account location is
        used for discovery.
      </p>
    </form>
  );
}
function UploadForm({ kind, listingId, onDone, onError }: any) {
  const [uploading, setUploading] = useState(false);
  return (
    <form
      className="upload-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = new FormData(form);
        if (listingId) d.set("listing_id", listingId);
        if (kind) d.set("kind", kind);
        setUploading(true);
        try {
          await api("/evidence", { method: "POST", body: d });
          form.reset();
          onDone();
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setUploading(false);
        }
      }}
    >
      {!kind && (
        <Field label="Evidence type">
          <select name="kind">
            <option value="photo">Material photograph</option>
            <option value="weighing_slip">Weighing slip</option>
          </select>
        </Field>
      )}
      <Field label="Select evidence file (maximum 5 MB)">
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
        />
      </Field>
      <button disabled={uploading} className="outline">
        {uploading ? <span className="spinner" /> : <Upload size={15} />}
        {uploading ? "Uploading…" : "Upload for review"}
      </button>
    </form>
  );
}
function ExchangeRow({ item: i, buyer, busy, onAction, onReview }: any) {
  const [actual, setActual] = useState(i.actual ?? i.quantity),
    [reviewing, setReviewing] = useState(false);
  return (
    <div className="exchange-item">
      <div className="item-main">
        <span className="item-icon">
          <Package size={22} />
        </span>
        <div>
          <h3>{i.title}</h3>
          <p>
            {i.seller_name} · {i.quantity} {i.unit} × {money(i.unit_price)}
          </p>
        </div>
        <span className={`status ${i.status}`}>{label(i.status)}</span>
      </div>
      <div className="item-actions">
        {i.status === "pending" && !buyer && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => onAction(i.id, "accept")}
            >
              Accept & reserve
            </button>
            <button
              className="outline"
              disabled={busy}
              onClick={() => onAction(i.id, "decline")}
            >
              Decline
            </button>
          </>
        )}
        {["pending", "accepted"].includes(i.status) &&
          !i.buyer_confirmed &&
          !i.seller_confirmed && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onAction(i.id, "cancel")}
            >
              Cancel item
            </button>
          )}
        {i.status === "accepted" && (
          <>
            <Field label={`Actual handover (${i.unit})`}>
              <input
                type="number"
                min="0"
                max={i.quantity}
                step={i.unit === "piece" ? 1 : 0.001}
                value={actual}
                onChange={(e) => setActual(+e.target.value)}
              />
            </Field>
            <button
              className="primary"
              disabled={
                busy || (buyer ? i.buyer_confirmed : i.seller_confirmed)
              }
              onClick={() => onAction(i.id, "confirm", actual)}
            >
              {(buyer ? i.buyer_confirmed : i.seller_confirmed)
                ? "Waiting for other party"
                : "Confirm handover"}
            </button>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => onAction(i.id, "dispute")}
            >
              Report issue
            </button>
          </>
        )}
        {i.status === "completed" && (
          <span className="completed-text">
            <Check size={15} />
            {i.actual} {i.unit} confirmed by both parties
          </span>
        )}
        {i.status === "completed" && buyer && !i.reviewed && (
          <button className="outline" onClick={() => setReviewing(!reviewing)}>
            Leave a review
          </button>
        )}
      </div>
      {reviewing && !i.reviewed && (
        <form
          className="review-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onReview(Number(f.get("rating")), f.get("comment"));
          }}
        >
          <Field label="Buyer rating">
            <select name="rating">
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </Field>
          <Field label="Your experience">
            <input name="comment" minLength={3} maxLength={500} required />
          </Field>
          <button disabled={busy} className="primary">
            Submit review
          </button>
        </form>
      )}
    </div>
  );
}
function ReviewCard({ kind, title, subtitle, note, onOpen, onDecide }: any) {
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement;
        onDecide(submitter.value === "approve", f.get("reference"));
      }}
    >
      {kind && <span className="review-kind">{kind}</span>}
      <h3>{title}</h3>
      <p className="mono">{subtitle}</p>
      {note && <p className="muted">{note}</p>}
      {onOpen && (
        <button type="button" className="outline" onClick={onOpen}>
          Download evidence
        </button>
      )}
      <Field label="Review reference and findings">
        <input
          name="reference"
          minLength={8}
          required
          placeholder="Source checked, date, and outcome"
        />
      </Field>
      <div className="button-row">
        <button className="primary" name="decision" value="approve">
          Approve review
        </button>
        <button className="outline" name="decision" value="reject">
          Reject
        </button>
      </div>
    </form>
  );
}

function Startup({
  waking,
  error,
  onRetry,
}: {
  waking: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="startup">
      <div className="startup-card">
        <span className="startup-mark">
          <img src="/logo-white.svg" alt="" width={30} height={27} />
        </span>
        <h1>
          Material<span className="brand-light">Setu</span>
        </h1>
        <p className="startup-tagline">THE MATERIAL EXCHANGE</p>
        {error ? (
          <>
            <p className="startup-status failed" role="alert">
              {error}
            </p>
            <p className="startup-hint">
              The exchange runs on a free server that sleeps when nobody is
              using it. Waking it takes up to a minute, so this often works on
              the second try.
            </p>
            <button className="primary" onClick={onRetry}>
              <RefreshCw size={16} /> Try again
            </button>
          </>
        ) : (
          <>
            <div className="startup-bar" aria-hidden="true">
              <span />
            </div>
            <p className="startup-status" role="status">
              {waking ? "Waking the server…" : "Loading the exchange…"}
            </p>
            <p className="startup-hint">
              {waking
                ? "Free hosting sleeps after a quiet spell. The first visit can take up to a minute; everything after it is quick."
                : "Fetching nearby materials and supplier evidence."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
function SkeletonCard() {
  return (
    <div className="listing-card skeleton" aria-hidden="true">
      <span className="skeleton-banner" />
      <div className="listing-body">
        <span className="skeleton-line short" />
        <span className="skeleton-line" />
        <span className="skeleton-line medium" />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
