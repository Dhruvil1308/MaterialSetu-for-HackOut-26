import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Image,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  createApi,
  money,
  label,
  requestKey,
  type User,
  type Listing,
  type SearchResult,
  type Material,
  type Exchange,
  type ExchangeItem,
  type Trust,
  type Pool,
} from "../../packages/shared";
const BASE =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android"
    ? "http://10.0.2.2:8000/api"
    : "http://localhost:8000/api");
let token: string | null = null;
const api = createApi(BASE, () => token);
async function saveToken(value: string | null) {
  token = value;
  if (Platform.OS === "web") {
    if (value) localStorage.setItem("materialsetu-mobile-token", value);
    else localStorage.removeItem("materialsetu-mobile-token");
  } else if (value) await SecureStore.setItemAsync("materialsetu-token", value);
  else await SecureStore.deleteItemAsync("materialsetu-token");
}
async function loadToken() {
  token =
    Platform.OS === "web"
      ? localStorage.getItem("materialsetu-mobile-token")
      : await SecureStore.getItemAsync("materialsetu-token");
}
const initial: SearchResult = {
  listings: [],
  pools: [],
  quantity: 50,
  unit: "kg",
  radius_km: 30,
  clarification: null,
  parsed: { method: "rules", material_ids: [] },
  pool_note: "",
};
type Tab = "discover" | "pools" | "exchanges" | "supply" | "account";
export default function App() {
  return (
    <SafeAreaProvider>
      <MaterialSetu />
    </SafeAreaProvider>
  );
}
function MaterialSetu() {
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [accounts, setAccounts] = useState<User[]>([]),
    [materials, setMaterials] = useState<Material[]>([]),
    [tab, setTab] = useState<Tab>("discover"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [data, setData] = useState(initial),
    [all, setAll] = useState<Listing[]>([]),
    [exchanges, setExchanges] = useState<Exchange[]>([]),
    [ownTrust, setOwnTrust] = useState<Trust | null>(null),
    [query, setQuery] = useState("50 kg plastic"),
    [radius, setRadius] = useState("30"),
    [transport, setTransport] = useState(""),
    [landed, setLanded] = useState(""),
    [rate, setRate] = useState("12"),
    [fee, setFee] = useState("40"),
    [filters, setFilters] = useState(false);
  const [sheet, setSheet] = useState<
      "login" | "create" | "detail" | "request" | null
    >(null),
    [selected, setSelected] = useState<Listing | null>(null),
    [profile, setProfile] = useState<any>(null),
    [request, setRequest] = useState<{
      items: { listing_id: string; quantity: number }[];
      key: string;
    } | null>(null),
    [pickup, setPickup] = useState(""),
    [gst, setGst] = useState("");
  const started = useRef(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function find(currentUser = user) {
    const r = await api<SearchResult>("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        latitude: currentUser?.latitude ?? 23.588,
        longitude: currentUser?.longitude ?? 72.369,
        radius_km: Number(radius),
        km_rate: Number(rate),
        stop_fee: Number(fee),
        max_transport: transport === "" ? null : Number(transport),
        max_unit_price: landed === "" ? null : Number(landed),
      }),
    });
    setData(r);
  }
  async function refresh(currentUser = user) {
    setAll(await api("/listings"));
    if (currentUser) {
      setExchanges(await api("/exchanges"));
      setOwnTrust(await api(`/businesses/${currentUser.id}/trust`));
    } else {
      setExchanges([]);
      setOwnTrust(null);
    }
  }
  async function signedIn(r: any) {
    setExchanges([]);
    setOwnTrust(null);
    await saveToken(r.token);
    setUser(r.user);
    setGst(r.user.gstin);
    setSheet(null);
    await refresh(r.user);
    await find(r.user);
    setMessage("Signed in. Searches use your business location.");
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(async () => {
      await loadToken();
      const health = await api("/health");
      setDemo(health.demo);
      setMaterials(await api("/taxonomy"));
      if (health.demo) setAccounts(await api("/demo/accounts"));
      let u = null;
      if (token) {
        try {
          u = await api<User>("/me");
          setUser(u);
          setGst(u.gstin);
        } catch {
          await saveToken(null);
        }
      }
      await refresh(u);
      await find(u);
    });
  }, []);
  function prepare(items: { listing_id: string; quantity: number }[]) {
    if (!user) {
      setSheet("login");
      return;
    }
    setRequest({ items, key: requestKey() });
    setPickup("");
    setSheet("request");
  }
  async function detail(l: Listing) {
    setSelected(l);
    setProfile(null);
    setSheet("detail");
    await run(async () =>
      setProfile(await api(`/businesses/${l.seller_id}/trust`)),
    );
  }
  async function itemAction(id: string, action: string, actual?: number) {
    await run(async () => {
      await api(`/exchange-items/${id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, actual }),
      });
      await refresh();
      await find();
      setMessage("Exchange updated.");
    });
  }
  async function sendEvidence(
    kind: string,
    listingId?: string,
    camera = false,
  ) {
    await run(async () => {
      let asset: { uri: string; name: string; mime: string } | null = null;
      if (kind === "photo") {
        let picked;
        if (camera) {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted)
            throw new Error(
              "Camera permission is needed to take a material photo.",
            );
          picked = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.7,
          });
        } else
          picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.7,
          });
        if (!picked.canceled) {
          const a = picked.assets[0];
          asset = {
            uri: a.uri,
            name: a.fileName || "material.jpg",
            mime: a.mimeType || "image/jpeg",
          };
        }
      } else {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
          copyToCacheDirectory: true,
        });
        if (!picked.canceled) {
          const a = picked.assets[0];
          asset = {
            uri: a.uri,
            name: a.name,
            mime: a.mimeType || "application/pdf",
          };
        }
      }
      if (!asset) return;
      const form = new FormData();
      form.append("kind", kind);
      if (listingId) form.append("listing_id", listingId);
      if (Platform.OS === "web") {
        const blob = await (await fetch(asset.uri)).blob();
        form.append("file", blob, asset.name);
      } else
        form.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mime,
        } as any);
      await api("/evidence", { method: "POST", body: form });
      const ls = await api<Listing[]>("/listings");
      setAll(ls);
      if (selected) {
        setSelected(ls.find((l) => l.id === selected.id) || selected);
        setProfile(await api(`/businesses/${selected.seller_id}/trust`));
      }
      await refresh();
      setMessage("Evidence uploaded. Points are added only after review.");
    });
  }
  const mine = all.filter((l) => l.seller_id === user?.id);
  return (
    <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View style={s.logo}>
          <Text style={s.logoText}>M</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>MaterialSetu</Text>
          <Text style={s.small}>
            {user?.city || "Mehsana"} · Local material exchange
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add material listing"
          style={s.add}
          onPress={() => setSheet(user ? "create" : "login")}
        >
          <Text style={s.addText}>+</Text>
        </Pressable>
      </View>
      {demo && (
        <View style={s.demo}>
          <Text style={s.demoText}>
            DEMO · Fictional businesses and evidence
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
          >
            {accounts.map((a) => (
              <Pressable
                accessibilityRole="button"
                key={a.id}
                disabled={busy}
                onPress={() =>
                  run(async () =>
                    signedIn(
                      await api("/auth/demo", {
                        method: "POST",
                        body: JSON.stringify({ business_id: a.id }),
                      }),
                    ),
                  )
                }
                style={[s.chip, a.id === user?.id && s.chipActive]}
              >
                <Text style={[s.chipText, a.id === user?.id && s.white]}>
                  {a.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() =>
              run(async () => {
                await refresh();
                await find();
              })
            }
            tintColor="#174b3a"
          />
        }
      >
        <Feedback error={error} message={message} />
        {(tab === "discover" || tab === "pools") && (
          <>
            <Text style={s.eyebrow}>LOCAL SUPPLY. NEW POSSIBILITIES.</Text>
            <Text style={s.hero}>
              {tab === "pools"
                ? "A little from each.\nEnough for you."
                : "The right material.\nCloser than you think."}
            </Text>
            <Text style={s.body}>
              Find nearby materials and combine compatible supply.
            </Text>
            <View style={s.searchBox}>
              <TextInput
                accessibilityLabel="Material demand"
                value={query}
                onChangeText={setQuery}
                style={s.searchInput}
                placeholder="50 kg plastic"
                placeholderTextColor="#718477"
                returnKeyType="search"
                onSubmitEditing={() => run(() => find())}
              />
              <Button
                title="Find materials →"
                onPress={() => run(() => find())}
                disabled={busy}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => setFilters(!filters)}
              >
                <Text style={s.filterLabel}>
                  {user?.city || "Mehsana"} · {radius} km radius / Filters &
                  transport
                </Text>
              </Pressable>
              {filters && (
                <>
                  <Input
                    label="Radius in km (1–100)"
                    value={radius}
                    onChangeText={setRadius}
                    numeric
                  />
                  <Input
                    label="Maximum transport budget ₹ (optional)"
                    value={transport}
                    onChangeText={setTransport}
                    numeric
                  />
                  <Input
                    label="Maximum total price per unit ₹ (optional)"
                    value={landed}
                    onChangeText={setLanded}
                    numeric
                  />
                  <View style={s.row}>
                    <View style={s.flex}>
                      <Input
                        label="Estimate ₹ / km"
                        value={rate}
                        onChangeText={setRate}
                        numeric
                      />
                    </View>
                    <View style={s.flex}>
                      <Input
                        label="Loading ₹ / stop"
                        value={fee}
                        onChangeText={setFee}
                        numeric
                      />
                    </View>
                  </View>
                  <Text style={s.small}>
                    Editable cost assumptions; not a transporter quote. Radius
                    uses straight-line distance.
                  </Text>
                </>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chips}
            >
              {materials.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  style={s.chip}
                  onPress={() =>
                    setQuery(
                      `${m.unit === "piece" ? 10 : 50} ${m.unit} ${m.id}`,
                    )
                  }
                >
                  <Text style={s.chipText}>{m.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={s.switchRow}>
              <Pressable
                onPress={() => setTab("discover")}
                style={[s.switch, tab === "discover" && s.switchActive]}
              >
                <Text
                  style={tab === "discover" ? s.switchTextActive : s.switchText}
                >
                  Listings · {data.listings.length}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTab("pools")}
                style={[s.switch, tab === "pools" && s.switchActive]}
              >
                <Text
                  style={tab === "pools" ? s.switchTextActive : s.switchText}
                >
                  Supply plans · {data.pools.length}
                </Text>
              </Pressable>
            </View>
            {tab === "discover" && (
              <>
                {data.clarification && (
                  <Text style={s.message}>{data.clarification}</Text>
                )}
                {data.listings.length === 0 ? (
                  <Empty
                    title="No matching material nearby"
                    text="Try a different material or a wider radius."
                  />
                ) : (
                  data.listings.map((l) => (
                    <MaterialCard
                      key={l.id}
                      listing={l}
                      onPress={() => detail(l)}
                    />
                  ))
                )}
              </>
            )}
            {tab === "pools" && (
              <>
                {data.pools.length === 0 ? (
                  <Empty
                    title="No complete plan fits yet"
                    text="Try increasing the radius or budget. Different material types and grades are kept separate."
                  />
                ) : (
                  data.pools.map((p, i) => (
                    <PoolCard
                      key={i}
                      pool={p}
                      name={
                        materials.find((m) => m.id === p.material_id)?.name ||
                        p.material_id
                      }
                      onPress={() =>
                        prepare(
                          p.items.map((l) => ({
                            listing_id: l.id,
                            quantity: l.take,
                          })),
                        )
                      }
                    />
                  ))
                )}
                <Text style={s.small}>{data.pool_note}</Text>
              </>
            )}
          </>
        )}
        {tab === "supply" && (
          <>
            <Heading eyebrow="YOUR MATERIALS" title="Make surplus useful." />
            <Text style={s.body}>
              Publish materials and attach photos or weighing slips.
            </Text>
            {!user ? (
              <Button
                title="Sign in to list materials"
                onPress={() => setSheet("login")}
              />
            ) : (
              <>
                <Button
                  title="+ List material"
                  onPress={() => setSheet("create")}
                />
                {mine.length === 0 && (
                  <Empty
                    title="No listings yet"
                    text="Create a listing to share your first material."
                  />
                )}
                {mine.map((l) => (
                  <MaterialCard
                    key={l.id}
                    listing={l}
                    onPress={() => detail(l)}
                  />
                ))}
              </>
            )}
          </>
        )}
        {tab === "exchanges" && (
          <>
            <Heading eyebrow="MOVE MATERIALS FORWARD" title="Your exchanges." />
            {!user ? (
              <Button
                title="Sign in to view exchanges"
                onPress={() => setSheet("login")}
              />
            ) : (
              <>
                {exchanges.length === 0 && (
                  <Empty
                    title="No requests yet"
                    text="Search for material and send a request to get started."
                  />
                )}
                {exchanges.map((e) => (
                  <View key={e.id} style={s.card}>
                    <Text style={s.cardTitle}>
                      {e.pooled ? "Pooled exchange" : "Material exchange"}
                    </Text>
                    <Text style={s.small}>
                      {e.buyer_id === user.id
                        ? "You are buying"
                        : `Buyer: ${e.buyer_name}`}{" "}
                      · #{e.id.slice(0, 8)}
                    </Text>
                    <Text style={s.body}>{e.pickup}</Text>
                    {e.pooled && (
                      <Text style={s.notice}>
                        {e.all_confirmed
                          ? "All suppliers accepted"
                          : "Wait for every supplier to accept before collection."}
                      </Text>
                    )}
                    {e.items.map((i) => (
                      <OrderItem
                        key={i.id}
                        item={i}
                        buyer={e.buyer_id === user.id}
                        busy={busy}
                        onAction={itemAction}
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
                            setMessage("Review saved.");
                          })
                        }
                      />
                    ))}
                  </View>
                ))}
              </>
            )}
          </>
        )}
        {tab === "account" && (
          <>
            <Heading
              eyebrow="CONFIDENCE THROUGH EVIDENCE"
              title="Trust, made clear."
            />
            {!user ? (
              <Button
                title="Sign in or register"
                onPress={() => setSheet("login")}
              />
            ) : (
              <>
                <View style={s.card}>
                  <Text style={s.cardTitle}>{user.name}</Text>
                  <Text style={s.body}>
                    {user.email} · {user.city}
                  </Text>
                  {ownTrust && <TrustCard trust={ownTrust} />}
                </View>
                <View style={s.card}>
                  <Text style={s.cardTitle}>GST review</Text>
                  <Text style={s.body}>
                    Status: {label(user.gst_status)}. A GSTIN format match does
                    not verify registration.
                  </Text>
                  <Input
                    label="GSTIN"
                    value={gst}
                    onChangeText={setGst}
                    uppercase
                  />
                  <Button
                    title="Submit for manual review"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await api("/me/gst", {
                          method: "POST",
                          body: JSON.stringify({ gstin: gst }),
                        });
                        setUser(await api("/me"));
                        await refresh();
                        setMessage(
                          "Submitted. No trust points are awarded until reviewed.",
                        );
                      })
                    }
                  />
                  <Button
                    title="Upload GST document"
                    outline
                    disabled={busy}
                    onPress={() => sendEvidence("gst_document")}
                  />
                </View>
                {user.role === "admin" && (
                  <Text style={s.notice}>
                    Use the website Review centre to inspect evidence, review
                    GST details and resolve disputes.
                  </Text>
                )}
                <Button
                  title="Sign out"
                  outline
                  onPress={() =>
                    run(async () => {
                      await api("/auth/logout", { method: "POST" });
                      await saveToken(null);
                      setUser(null);
                      await refresh(null);
                      await find(null);
                    })
                  }
                />
              </>
            )}
          </>
        )}
        <Text style={s.footer}>MATERIALSETU / TECH TITANS</Text>
      </ScrollView>
      <View style={s.bottomNav}>
        {(
          [
            ["discover", "⌕", "Discover"],
            ["pools", "▤", "Pools"],
            ["exchanges", "⇄", "Exchanges"],
            ["supply", "+", "Supply"],
            ["account", "◎", "Account"],
          ] as [Tab, string, string][]
        ).map(([id, icon, title]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === id }}
            onPress={() => setTab(id)}
            style={s.navItem}
          >
            <Text style={[s.navIcon, tab === id && s.navSelected]}>{icon}</Text>
            <Text style={[s.navText, tab === id && s.navSelected]}>
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={sheet !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSheet(null)}
      >
        <SafeAreaView style={s.screen}>
          <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={s.sheetHeader}>
              <Text style={s.cardTitle}>
                {sheet === "login"
                  ? "Business account"
                  : sheet === "create"
                    ? "List material"
                    : sheet === "request"
                      ? "Request material"
                      : "Material details"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close details"
                onPress={() => setSheet(null)}
              >
                <Text style={s.close}>×</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              <Feedback error={error} message={message} />
              {busy && <ActivityIndicator color="#174b3a" />}
              {sheet === "login" && (
                <LoginForm
                  busy={busy}
                  onSubmit={(path: string, body: any) =>
                    run(async () =>
                      signedIn(
                        await api(path, {
                          method: "POST",
                          body: JSON.stringify(body),
                        }),
                      ),
                    )
                  }
                />
              )}
              {sheet === "create" && (
                <CreateForm
                  materials={materials}
                  busy={busy}
                  onSuggest={(text) =>
                    api("/classify", {
                      method: "POST",
                      body: JSON.stringify({ text }),
                    })
                  }
                  onSubmit={(body) =>
                    run(async () => {
                      const l = await api<Listing>("/listings", {
                        method: "POST",
                        body: JSON.stringify(body),
                      });
                      await refresh();
                      setSelected(l);
                      setProfile(await api(`/businesses/${l.seller_id}/trust`));
                      setSheet("detail");
                      setMessage("Listing published. Add evidence below.");
                    })
                  }
                />
              )}
              {sheet === "detail" && selected && (
                <>
                  <Text style={s.eyebrow}>
                    {selected.material.name.toUpperCase()} /{" "}
                    {label(selected.intent).toUpperCase()}
                  </Text>
                  <Text style={s.hero}>{selected.title}</Text>
                  <Text style={s.body}>
                    {selected.seller.name} · {selected.seller.city}
                  </Text>
                  <View style={[s.card, s.detailMetric]}>
                    <Text style={s.price}>
                      {money(selected.price)} / {selected.unit}
                    </Text>
                    <Text style={s.body}>
                      {selected.available} {selected.unit} available
                    </Text>
                  </View>
                  <Text style={s.body}>{selected.description}</Text>
                  {selected.dimensions && (
                    <Text style={s.body}>
                      Dimensions: {selected.dimensions}
                    </Text>
                  )}
                  <Text style={s.cardTitle}>Potential uses</Text>
                  {selected.material.uses.map((u) => (
                    <Text key={u} style={s.notice}>
                      {u}
                    </Text>
                  ))}
                  <Text style={s.small}>{selected.material.note}</Text>
                  <Text style={[s.cardTitle, { marginTop: 20 }]}>
                    Listing evidence
                  </Text>
                  {selected.evidence
                    .filter((e) => e.kind === "photo")
                    .map((e) => (
                      <View key={e.id} style={s.card}>
                        <Image
                          source={{ uri: `${BASE}/evidence/${e.id}` }}
                          style={{ width: "100%", height: 170 }}
                          resizeMode="contain"
                          accessibilityLabel="Supplier material photograph"
                        />
                        <Text style={s.small}>
                          Supplier photo · {e.status}
                          {selected.seller.is_demo
                            ? " · Demonstration only"
                            : ""}
                        </Text>
                      </View>
                    ))}
                  {selected.evidence.length ? (
                    selected.evidence.map((e) => (
                      <Text key={e.id} style={s.body}>
                        {label(e.kind)} · {e.status}
                      </Text>
                    ))
                  ) : (
                    <Text style={s.body}>No evidence uploaded yet.</Text>
                  )}
                  {selected.seller_id === user?.id && (
                    <>
                      <Button
                        title="Choose material photo"
                        outline
                        disabled={busy}
                        onPress={() => sendEvidence("photo", selected.id)}
                      />
                      {Platform.OS !== "web" && (
                        <Button
                          title="Take a material photo"
                          outline
                          disabled={busy}
                          onPress={() =>
                            sendEvidence("photo", selected.id, true)
                          }
                        />
                      )}
                      <Button
                        title="Upload weighing slip"
                        outline
                        disabled={busy}
                        onPress={() =>
                          sendEvidence("weighing_slip", selected.id)
                        }
                      />
                    </>
                  )}
                  {profile && (
                    <View style={s.card}>
                      <TrustCard trust={profile} />
                      {profile.reviews.slice(0, 3).map((r: any, i: number) => (
                        <Text key={i} style={s.body}>
                          {r.rating}/5 · {r.comment}
                        </Text>
                      ))}
                    </View>
                  )}
                  {selected.seller_id !== user?.id && (
                    <QuantityRequest
                      available={selected.available}
                      unit={selected.unit}
                      onRequest={(q) =>
                        prepare([{ listing_id: selected.id, quantity: q }])
                      }
                    />
                  )}
                </>
              )}
              {sheet === "request" && request && (
                <>
                  <Text style={s.body}>
                    Stock is reserved only after supplier acceptance. Each
                    supplier in a pool confirms separately.
                  </Text>
                  {request.items.map((i) => (
                    <View key={i.listing_id} style={s.card}>
                      <Text style={s.cardTitle}>
                        {all.find((l) => l.id === i.listing_id)?.title}
                      </Text>
                      <Text style={s.price}>
                        {i.quantity}{" "}
                        {all.find((l) => l.id === i.listing_id)?.unit}
                      </Text>
                    </View>
                  ))}
                  <Input
                    label="Proposed pickup details"
                    value={pickup}
                    onChangeText={setPickup}
                    multiline
                  />
                  <Text style={s.small}>
                    Distance checks use your registered business location.
                    Transport estimates are not bookings.
                  </Text>
                  <Button
                    title="Send exchange request →"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await api("/exchanges", {
                          method: "POST",
                          body: JSON.stringify({
                            items: request.items,
                            idempotency_key: request.key,
                            pickup: pickup || "Arrange pickup with supplier",
                            radius_km: data.radius_km || Number(radius),
                          }),
                        });
                        await refresh();
                        setSheet(null);
                        setTab("exchanges");
                        setMessage(
                          "Request sent. Waiting for supplier acceptance.",
                        );
                      })
                    }
                  />
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.hero}>{title}</Text>
    </>
  );
}
function Feedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!message && <Text style={s.message}>{message}</Text>}
    </>
  );
}
function Button({
  title,
  onPress,
  outline = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  outline?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[s.button, outline && s.outline, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.buttonText, outline && s.outlineText]}>{title}</Text>
    </Pressable>
  );
}
function Input({
  label: txt,
  value,
  onChangeText,
  numeric = false,
  multiline = false,
  secure = false,
  uppercase = false,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  secure?: boolean;
  uppercase?: boolean;
}) {
  return (
    <View style={s.inputWrap}>
      <Text style={s.inputLabel}>{txt}</Text>
      <TextInput
        accessibilityLabel={txt}
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? "decimal-pad" : "default"}
        secureTextEntry={secure}
        autoCapitalize={uppercase ? "characters" : "none"}
        multiline={multiline}
        style={[s.input, multiline && { height: 85, textAlignVertical: "top" }]}
      />
    </View>
  );
}
function Chips({
  values,
  value,
  onChange,
}: {
  values: { id: string; name: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.chips}
    >
      {values.map((v) => (
        <Pressable
          accessibilityRole="button"
          key={v.id}
          style={[s.chip, value === v.id && s.chipActive]}
          onPress={() => onChange(v.id)}
        >
          <Text style={[s.chipText, value === v.id && s.white]}>{v.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={[s.card, { paddingVertical: 32 }]}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.body}>{text}</Text>
    </View>
  );
}
function MaterialCard({
  listing: l,
  onPress,
}: {
  listing: Listing;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={s.materialCard}
    >
      <View style={s.materialBanner}>
        <Text style={s.materialCode}>{l.material_id.toUpperCase()}</Text>
        <Text style={s.materialCategory}>
          {l.material.category} · {label(l.intent)}
        </Text>
        <Text style={s.distance}>
          {l.distance_km !== null ? `${l.distance_km} km` : l.seller.city}
        </Text>
      </View>
      <View style={{ padding: 17 }}>
        <View style={s.between}>
          <Text style={s.small}>{label(l.grade)}</Text>
          <Text style={s.trustBadge}>Trust {l.trust.score}/100</Text>
        </View>
        <Text style={[s.cardTitle, { marginTop: 9 }]}>{l.title}</Text>
        <Text style={s.body}>{l.seller.name}</Text>
        <View style={s.between}>
          <Text style={s.price}>
            {money(l.price)}
            <Text style={s.small}> / {l.unit}</Text>
          </Text>
          <Text style={s.small}>
            {l.available} {l.unit} available
          </Text>
        </View>
        <Text style={s.cardBottom}>
          {l.evidence.filter((e) => e.status === "approved").length} reviewed
          evidence files View details ↗
        </Text>
      </View>
    </Pressable>
  );
}
function PoolCard({
  pool: p,
  name,
  onPress,
}: {
  pool: Pool;
  name: string;
  onPress: () => void;
}) {
  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>
        {p.supplier_count} LOCAL SUPPLIER{p.supplier_count === 1 ? "" : "S"}
      </Text>
      <Text style={s.cardTitle}>
        {p.quantity} {p.unit} · {name}
      </Text>
      <Text style={s.small}>
        {label(p.grade)} · {label(p.intent)}
      </Text>
      {p.items.map((l, i) => (
        <View key={l.id} style={s.poolItem}>
          <Text style={s.poolStep}>{i + 1}</Text>
          <View style={s.flex}>
            <Text style={s.inputLabel}>{l.seller.name}</Text>
            <Text style={s.small}>{l.distance_km} km away</Text>
          </View>
          <Text style={s.inputLabel}>
            {l.take} {l.unit}
          </Text>
        </View>
      ))}
      <View style={s.costRow}>
        <Text style={s.body}>Materials</Text>
        <Text>{money(p.material_cost)}</Text>
      </View>
      <View style={s.costRow}>
        <Text style={s.body}>Transport estimate</Text>
        <Text>{money(p.transport_cost)}</Text>
      </View>
      <View style={s.costRow}>
        <Text style={s.cardTitle}>Estimated total</Text>
        <Text style={s.price}>{money(p.total_cost)}</Text>
      </View>
      <Text style={s.small}>
        {p.estimated_route_km} km estimated round trip. Confirm an actual quote.
      </Text>
      <Button title="Request this supply →" onPress={onPress} />
    </View>
  );
}
function TrustCard({ trust: t }: { trust: Trust }) {
  return (
    <>
      <View style={s.trustHeader}>
        <Text style={s.bigScore}>
          {t.score}
          <Text style={s.body}>/100</Text>
        </Text>
        <View style={s.flex}>
          <Text style={s.cardTitle}>Evidence score</Text>
          <Text style={s.small}>
            {t.is_demo
              ? "Simulated demo evidence"
              : `${t.completed} confirmed handovers`}
          </Text>
        </View>
      </View>
      {t.parts.map((p) => (
        <View key={p.label} style={{ marginBottom: 15 }}>
          <View style={s.between}>
            <Text style={s.inputLabel}>{p.label}</Text>
            <Text style={s.small}>
              {p.points} / {p.max}
            </Text>
          </View>
          <View style={s.progress}>
            <View
              style={[
                s.progressFill,
                { width: `${(p.points / p.max) * 100}%` },
              ]}
            />
          </View>
          <Text style={s.small}>{p.detail}</Text>
        </View>
      ))}
      <Text style={s.small}>{t.note}</Text>
    </>
  );
}
function LoginForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (path: string, body: any) => void;
}) {
  const [reg, setReg] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [city, setCity] = useState("Mehsana"),
    [lat, setLat] = useState("23.588"),
    [lon, setLon] = useState("72.369");
  return (
    <>
      <Text style={s.hero}>{reg ? "Join the exchange." : "Welcome back."}</Text>
      {reg && (
        <>
          <Input label="Business name" value={name} onChangeText={setName} />
          <Input label="City" value={city} onChangeText={setCity} />
          <Input
            label="Business latitude"
            value={lat}
            onChangeText={setLat}
            numeric
          />
          <Input
            label="Business longitude"
            value={lon}
            onChangeText={setLon}
            numeric
          />
        </>
      )}
      <Input label="Email" value={email} onChangeText={setEmail} />
      <Input
        label="Password (minimum 10 characters for registration)"
        value={password}
        onChangeText={setPassword}
        secure
      />
      <Button
        title={reg ? "Create account" : "Sign in"}
        disabled={busy}
        onPress={() =>
          onSubmit(
            reg ? "/auth/register" : "/auth/login",
            reg
              ? {
                  email,
                  password,
                  name,
                  city,
                  latitude: Number(lat),
                  longitude: Number(lon),
                }
              : { email, password },
          )
        }
      />
      <Button
        title={
          reg ? "Already registered? Sign in" : "Create a business account"
        }
        outline
        onPress={() => setReg(!reg)}
      />
    </>
  );
}
function CreateForm({
  materials,
  busy,
  onSubmit,
  onSuggest,
}: {
  materials: Material[];
  busy: boolean;
  onSubmit: (b: any) => void;
  onSuggest: (t: string) => Promise<any>;
}) {
  const [description, setDescription] = useState(""),
    [title, setTitle] = useState(""),
    [mid, setMid] = useState("pet"),
    [grade, setGrade] = useState("clean_sorted"),
    [intent, setIntent] = useState("recycle"),
    [qty, setQty] = useState(""),
    [price, setPrice] = useState(""),
    [dimensions, setDimensions] = useState(""),
    [hint, setHint] = useState("");
  return (
    <>
      <Input
        label="Describe the material"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Button
        title="Suggest category from description"
        outline
        onPress={async () => {
          try {
            const r = await onSuggest(description);
            setHint(
              r.suggestions.length
                ? `Suggested: ${r.suggestions.map((m: Material) => m.name).join(", ")}. Confirm below.`
                : "Choose a category manually.",
            );
            if (r.suggestions.length === 1) setMid(r.suggestions[0].id);
          } catch {
            setHint("Suggestions unavailable. Choose a category manually.");
          }
        }}
      />
      <Text style={s.small}>
        {hint || "Keyword-based classification. No image model is connected."}
      </Text>
      <Input label="Listing title" value={title} onChangeText={setTitle} />
      <Text style={s.inputLabel}>Confirmed material</Text>
      <Chips values={materials} value={mid} onChange={setMid} />
      <Text style={s.inputLabel}>Condition</Text>
      <Chips
        values={[
          { id: "clean_sorted", name: "Clean & sorted" },
          { id: "used_sorted", name: "Used & sorted" },
          { id: "mixed", name: "Mixed" },
        ]}
        value={grade}
        onChange={setGrade}
      />
      <Text style={s.inputLabel}>Intended destination</Text>
      <Chips
        values={[
          { id: "recycle", name: "Recycling" },
          { id: "reuse", name: "Reuse" },
        ]}
        value={intent}
        onChange={setIntent}
      />
      <Input
        label={`Quantity (${materials.find((m) => m.id === mid)?.unit})`}
        value={qty}
        onChangeText={setQty}
        numeric
      />
      <Input
        label="Price per unit ₹ (0 for free)"
        value={price}
        onChangeText={setPrice}
        numeric
      />
      <Input
        label="Dimensions if relevant"
        value={dimensions}
        onChangeText={setDimensions}
      />
      <Button
        title="Publish listing →"
        disabled={busy}
        onPress={() =>
          onSubmit({
            title,
            description,
            material_id: mid,
            grade,
            intent,
            quantity: Number(qty),
            price: Number(price),
            dimensions,
          })
        }
      />
      <Text style={s.small}>
        Add material photos and weighing evidence after publishing.
      </Text>
    </>
  );
}
function QuantityRequest({
  available,
  unit,
  onRequest,
}: {
  available: number;
  unit: string;
  onRequest: (q: number) => void;
}) {
  const [q, setQ] = useState(String(Math.min(50, available)));
  return (
    <>
      <Input
        label={`Request quantity (${unit})`}
        value={q}
        onChangeText={setQ}
        numeric
      />
      <Button
        title="Request material →"
        disabled={Number(q) <= 0 || Number(q) > available}
        onPress={() => onRequest(Number(q))}
      />
    </>
  );
}
function OrderItem({
  item: i,
  buyer,
  busy,
  onAction,
  onReview,
}: {
  item: ExchangeItem;
  buyer: boolean;
  busy: boolean;
  onAction: (id: string, action: string, actual?: number) => void;
  onReview: (rating: number, comment: string) => void;
}) {
  const [actual, setActual] = useState(String(i.actual ?? i.quantity)),
    [review, setReview] = useState(false),
    [rating, setRating] = useState("5"),
    [comment, setComment] = useState("");
  return (
    <View style={s.order}>
      <Text style={s.cardTitle}>{i.title}</Text>
      <Text style={s.body}>
        {i.quantity} {i.unit} × {money(i.unit_price)} · {label(i.status)}
      </Text>
      {i.status === "pending" && !buyer && (
        <>
          <Button
            title="Accept and reserve"
            disabled={busy}
            onPress={() => onAction(i.id, "accept")}
          />
          <Button
            title="Decline"
            outline
            disabled={busy}
            onPress={() => onAction(i.id, "decline")}
          />
        </>
      )}
      {["pending", "accepted"].includes(i.status) &&
        !i.seller_confirmed &&
        !i.buyer_confirmed && (
          <Button
            title="Cancel item"
            outline
            disabled={busy}
            onPress={() => onAction(i.id, "cancel")}
          />
        )}{" "}
      {i.status === "accepted" && (
        <>
          <Input
            label={`Actual handover (${i.unit})`}
            value={actual}
            onChangeText={setActual}
            numeric
          />
          <Button
            title={
              (buyer ? i.buyer_confirmed : i.seller_confirmed)
                ? "Waiting for other party"
                : "Confirm handover"
            }
            disabled={busy || (buyer ? i.buyer_confirmed : i.seller_confirmed)}
            onPress={() => onAction(i.id, "confirm", Number(actual))}
          />
          <Button
            title="Report an issue"
            outline
            disabled={busy}
            onPress={() => onAction(i.id, "dispute")}
          />
        </>
      )}
      {i.status === "completed" && (
        <Text style={s.notice}>
          {i.actual} {i.unit} confirmed by both parties
        </Text>
      )}
      {i.status === "completed" && buyer && !i.reviewed && (
        <>
          <Button
            title="Leave a buyer review"
            outline
            onPress={() => setReview(!review)}
          />
          {review && (
            <>
              <Chips
                values={[1, 2, 3, 4, 5].map((n) => ({
                  id: String(n),
                  name: `${n} ★`,
                }))}
                value={rating}
                onChange={setRating}
              />
              <Input
                label="Your experience"
                value={comment}
                onChangeText={setComment}
                multiline
              />
              <Button
                title="Submit review"
                disabled={busy || comment.length < 3}
                onPress={() => onReview(Number(rating), comment)}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f8f7" },
  flex: { flex: 1 },
  row: { flexDirection: "row", gap: 12 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderColor: "#dce5de",
  },
  logo: {
    backgroundColor: "#174b3a",
    width: 35,
    height: 37,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "white", fontWeight: "700", fontSize: 23 },
  brand: {
    fontSize: 22,
    fontWeight: "700",
    color: "#163d2d",
    letterSpacing: -0.8,
  },
  small: { fontSize: 12, lineHeight: 18, color: "#748579" },
  add: {
    backgroundColor: "#e8f0ea",
    borderRadius: 9,
    width: 38,
    height: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  addText: { fontSize: 26, color: "#174b3a" },
  demo: {
    backgroundColor: "#f6eed9",
    paddingTop: 9,
    paddingHorizontal: 20,
    paddingBottom: 3,
  },
  demoText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#786740",
    letterSpacing: 0.5,
  },
  chips: { flexDirection: "row", gap: 7, paddingVertical: 12 },
  chip: {
    borderWidth: 1,
    borderColor: "#d5dfd7",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  chipActive: { backgroundColor: "#174b3a", borderColor: "#174b3a" },
  chipText: { fontSize: 12, color: "#5b7463" },
  white: { color: "#fff" },
  content: { padding: 20, paddingBottom: 35 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "600",
    color: "#6d8876",
    marginTop: 8,
    marginBottom: 12,
  },
  hero: {
    fontSize: 33,
    fontWeight: "600",
    lineHeight: 39,
    letterSpacing: -1,
    color: "#174b3a",
    marginBottom: 12,
  },
  body: { fontSize: 14, lineHeight: 21, color: "#6c7d70", marginBottom: 10 },
  searchBox: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dce5de",
    borderRadius: 12,
    padding: 15,
    marginTop: 13,
  },
  searchInput: {
    fontSize: 18,
    color: "#203b2b",
    paddingVertical: 9,
    paddingHorizontal: 5,
  },
  button: {
    backgroundColor: "#174b3a",
    paddingHorizontal: 17,
    paddingVertical: 14,
    borderRadius: 7,
    marginVertical: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#174b3a",
  },
  buttonText: { fontSize: 14, fontWeight: "600", color: "white" },
  outline: { backgroundColor: "#fff", borderColor: "#cbd9cf" },
  outlineText: { color: "#174b3a" },
  filterLabel: {
    fontSize: 12,
    color: "#718674",
    paddingTop: 8,
    paddingBottom: 3,
  },
  inputWrap: { marginVertical: 9 },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#425e4a",
    marginBottom: 5,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccdacd",
    borderRadius: 6,
    padding: 12,
    fontSize: 15,
    color: "#213c2b",
  },
  switchRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#d6e0d8",
    marginBottom: 20,
    gap: 20,
  },
  switch: { paddingVertical: 12 },
  switchActive: { borderBottomWidth: 2, borderColor: "#174b3a" },
  switchText: { fontSize: 13, color: "#718877" },
  switchTextActive: { fontSize: 13, color: "#174b3a", fontWeight: "700" },
  materialCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dde6df",
    borderRadius: 11,
    marginBottom: 16,
    overflow: "hidden",
  },
  materialBanner: {
    backgroundColor: "#e5eee7",
    padding: 20,
    minHeight: 100,
    justifyContent: "center",
  },
  materialCode: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1,
    color: "#688a71",
  },
  materialCategory: {
    fontSize: 11,
    letterSpacing: 1,
    color: "#6a8372",
    marginTop: 5,
  },
  distance: {
    position: "absolute",
    right: 12,
    top: 12,
    fontSize: 11,
    color: "#46684e",
    backgroundColor: "#ffffffc9",
    padding: 5,
    borderRadius: 4,
  },
  trustBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#39734b",
    backgroundColor: "#edf5ed",
    padding: 5,
    borderRadius: 5,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "600",
    color: "#294934",
    marginBottom: 7,
  },
  price: {
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.4,
    color: "#234931",
  },
  cardBottom: {
    fontSize: 11,
    color: "#7b9080",
    borderTopWidth: 1,
    borderColor: "#edf2ed",
    marginTop: 16,
    paddingTop: 12,
  },
  card: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#dce5de",
    backgroundColor: "#fff",
    padding: 20,
    marginVertical: 9,
  },
  poolItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 13,
  },
  poolStep: {
    fontSize: 13,
    color: "#54775b",
    padding: 7,
    backgroundColor: "#eef3ed",
    borderRadius: 20,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    gap: 10,
  },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderColor: "#dae4dc",
    paddingTop: 8,
    paddingBottom: 9,
  },
  navItem: { flex: 1, alignItems: "center", gap: 3 },
  navIcon: { fontSize: 24, color: "#8a9c8e", lineHeight: 28 },
  navText: { fontSize: 10, color: "#819386" },
  navSelected: { color: "#174b3a", fontWeight: "700" },
  footer: {
    textAlign: "center",
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#8b9d8e",
    marginTop: 30,
  },
  error: {
    backgroundColor: "#fbe8e0",
    color: "#993e22",
    padding: 13,
    borderRadius: 7,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  message: {
    backgroundColor: "#e3f0e6",
    color: "#386d45",
    padding: 13,
    borderRadius: 7,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  notice: {
    backgroundColor: "#edf4ee",
    color: "#4d7758",
    fontSize: 12,
    padding: 10,
    borderRadius: 6,
    marginVertical: 7,
    lineHeight: 18,
  },
  sheetHeader: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#dce5de",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  close: { fontSize: 31, color: "#466b50", paddingHorizontal: 8 },
  detailMetric: { backgroundColor: "#edf4ee" },
  trustHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    marginBottom: 20,
  },
  bigScore: { fontSize: 43, fontWeight: "600", color: "#285c37" },
  progress: {
    height: 5,
    backgroundColor: "#eaf1eb",
    borderRadius: 5,
    marginVertical: 9,
    overflow: "hidden",
  },
  progressFill: { height: 5, backgroundColor: "#638b6c" },
  order: {
    borderTopWidth: 1,
    borderColor: "#dce5de",
    paddingTop: 17,
    marginTop: 15,
  },
});
