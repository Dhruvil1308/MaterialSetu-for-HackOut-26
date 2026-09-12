export type User = {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  gst_status: string;
  is_demo: boolean;
  email: string;
  gstin: string;
  role: string;
  /** What the business came here to do. Reviewers are made by an operator. */
  kind: "buyer" | "supplier" | "both";
};
export type Trust = {
  score: number;
  parts: { label: string; points: number; max: number; detail: string }[];
  completed: number;
  review_count: number;
  average_rating: number | null;
  is_demo: boolean;
  note: string;
};
export type Material = {
  id: string;
  name: string;
  category: string;
  unit: string;
  uses: string[];
  note: string;
};
export type Evidence = {
  id: string;
  kind: string;
  status: string;
  url: string;
  mime: string;
};
export type Listing = {
  id: string;
  seller_id: string;
  title: string;
  material_id: string;
  grade: string;
  intent: string;
  quantity: number;
  available: number;
  price: number;
  unit: string;
  description: string;
  dimensions: string;
  seller: User;
  latitude: number;
  longitude: number;
  distance_km: number | null;
  trust: Trust;
  material: Material;
  evidence: Evidence[];
};
export type Pool = {
  material_id: string;
  grade: string;
  intent: string;
  unit: string;
  quantity: number;
  items: (Listing & { take: number })[];
  supplier_count: number;
  estimated_route_km: number;
  material_cost: number;
  transport_cost: number;
  total_cost: number;
  cost_per_unit: number;
  estimate_note: string;
};
export type SearchResult = {
  listings: Listing[];
  pools: Pool[];
  quantity: number;
  unit: string;
  radius_km: number;
  clarification: string | null;
  parsed: { method: string; material_ids: string[] };
  pool_note: string;
};
export type ExchangeItem = {
  id: string;
  listing_id: string;
  seller_id: string;
  quantity: number;
  unit_price: number;
  status: string;
  actual: number | null;
  seller_confirmed: boolean;
  buyer_confirmed: boolean;
  title: string;
  unit: string;
  seller_name: string;
  reviewed: boolean;
};
export type Exchange = {
  id: string;
  buyer_id: string;
  buyer_name: string;
  pickup: string;
  created: number;
  pooled: boolean;
  all_confirmed: boolean;
  items: ExchangeItem[];
};
export const money = (v: number) =>
  `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const label = (s: string) => s.replaceAll("_", " ");
export const requestKey = () =>
  `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
export function createApi(base: string, getToken: () => string | null) {
  return async function api<T = any>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = getToken();
    const multipart =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...(!multipart ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ detail: "Request failed" }));
      throw new Error(
        typeof data.detail === "string"
          ? data.detail
          : "Please check the entered values.",
      );
    }
    return response.json();
  };
}
