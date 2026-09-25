"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./studio.module.css";

type Organization = { id: string; name: string };
type Membership = { organizations: Organization | null };
type VaultItem = { id: string; provider: string; display_name: string; key_hint: string | null; base_url: string | null; model_allowlist: string[]; status: string; rotated_at: string | null };
type ModelInfo = { id: string; label: string; contextLength?: number; free?: boolean; vision?: boolean };
type ModelState = { models: ModelInfo[]; count: number; loadedAt: string; error?: string };
type TestState = { ok: boolean; message: string; latencyMs?: number; at: string };

const PROVIDERS = [
  { value: "openrouter", label: "OpenRouter", note: "Model gateway; free tier models auto-discovered." },
  { value: "openai", label: "OpenAI", note: "GPT models via api.openai.com." },
  { value: "anthropic", label: "Anthropic", note: "Claude models via api.anthropic.com." },
  { value: "google", label: "Google Gemini", note: "Gemini models via generativelanguage.googleapis.com." },
  { value: "groq", label: "Groq", note: "Ultra-fast open-source model hosting." },
  { value: "custom", label: "Custom endpoint", note: "OpenAI-compatible endpoint (Azure, vLLM, LiteLLM, self-hosted)." },
];

export default function AiStudioPage() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modelState, setModelState] = useState<Record<string, ModelState>>({});
  const [testState, setTestState] = useState<Record<string, TestState>>({});

  async function load(org?: Organization | null) {
    const target = org || organization;
    if (!target) return;
    const response = await fetch(`/api/provider-credentials?organizationId=${encodeURIComponent(target.id)}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) setItems(data.credentials || []);
    else setError(data.error || "Unable to load credentials.");
  }
  useEffect(() => {
    fetch("/api/organizations", { cache: "no-store" })
      .then(async response => { const data = await response.json() as { memberships?: Membership[] }; const org = (data.memberships || []).map(item => item.organizations).find((item): item is Organization => Boolean(item)) || null; setOrganization(org); if (org) await load(org); })
      .catch(() => setError("Unable to load AI Studio."));
  }, []);

  const currentProvider = PROVIDERS.find(p => p.value === provider);

  async function save() {
    if (!organization) return;
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/provider-credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, provider, displayName: displayName || provider, apiKey, baseUrl: baseUrl || undefined, modelAllowlist: models.split(",").map(v => v.trim()).filter(Boolean), scopes: ["chat", "generate", "models", "test"] }) });
    const data = await response.json();
    if (response.ok) { setApiKey(""); setMessage("Credential encrypted and stored. The secret will not be displayed again."); await load(); }
    else setError(data.error || "Unable to save credential.");
    setBusy(false);
  }

  async function test(id: string) {
    setBusy(true); setError(""); setMessage("");
    // Invoked from a button click, not during render — measure real network latency.
    // eslint-disable-next-line react-hooks/purity
    const started = Date.now();
    const response = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialId: id }) });
    const data = await response.json();
    // eslint-disable-next-line react-hooks/purity
    const at = new Date().toISOString();
    if (response.ok) {
      // eslint-disable-next-line react-hooks/purity
      const latency = typeof data.latencyMs === "number" ? data.latencyMs : Date.now() - started;
      setTestState(current => ({ ...current, [id]: { ok: true, message: data.message || "Provider connection succeeded.", latencyMs: latency, at } }));
      setMessage(`${data.message || "Provider connection succeeded."} (${latency} ms)`);
    } else {
      setTestState(current => ({ ...current, [id]: { ok: false, message: data.error || "Connection test failed.", at } }));
      setError(data.error || "Connection test failed.");
    }
    setBusy(false);
  }

  async function testBeforeSave() {
    if (!organization || !apiKey) return;
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/provider-credentials/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, provider, apiKey, baseUrl: baseUrl || undefined, model: models.split(",")[0]?.trim() || undefined }) });
    const data = await response.json();
    if (response.ok) setMessage(data.message || "Provider connection succeeded. The secret was not stored.");
    else setError(data.error || "Connection test failed.");
    setBusy(false);
  }

  async function rotate() {
    if (!organization || !rotateId || !rotateKey) return;
    setBusy(true); setError(""); setMessage("");
    const response = await fetch("/api/provider-credentials", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, credentialId: rotateId, apiKey: rotateKey }) });
    const data = await response.json();
    if (response.ok) { setRotateKey(""); setRotateId(null); setMessage("Credential rotated. The previous secret is no longer active."); await load(); }
    else setError(data.error || "Unable to rotate credential.");
    setBusy(false);
  }

  async function revoke(id: string) {
    if (!organization) return;
    if (!window.confirm("Revoke this credential? Existing AI operations using it will stop.")) return;
    setBusy(true); setError("");
    const response = await fetch("/api/provider-credentials", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, credentialId: id }) });
    const data = await response.json();
    if (response.ok) { setMessage("Credential revoked."); await load(); }
    else setError(data.error || "Unable to revoke credential.");
    setBusy(false);
  }

  async function discover(id: string) {
    setDiscovering(id); setError("");
    const response = await fetch("/api/ai/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentialId: id }) });
    const data = await response.json();
    // eslint-disable-next-line react-hooks/purity
    const at = new Date().toISOString();
    if (response.ok) {
      setModelState(current => ({ ...current, [id]: { models: (data.models || []) as ModelInfo[], count: data.count || 0, loadedAt: at } }));
      setExpanded(id);
    } else {
      setModelState(current => ({ ...current, [id]: { models: [], count: 0, loadedAt: at, error: data.error || "Model discovery failed." } }));
      setError(data.error || "Model discovery failed.");
    }
    setDiscovering(null);
  }

  return (
    <main className={styles.page}>
      <header>
        <div>
          <span>WEBOPS AI / GOVERNED INTELLIGENCE</span>
          <h1>AI Studio</h1>
          <p>Encrypted provider credentials, live model discovery, and per-provider governance.</p>
        </div>
        <Link href="/workspace">← Command Center</Link>
      </header>
      {error && <div className={styles.error}>{error} <button onClick={() => setError("")} style={{ marginLeft: 8 }}>Dismiss</button></div>}
      {message && <div className={styles.success}>{message}</div>}
      <section className={styles.grid}>
        <article className={styles.card}>
          <span>ADD PROVIDER</span>
          <h2>Secure credential vault</h2>
          <p>The key is encrypted server-side with AES-256-GCM and never returned after creation.</p>
          <label>Provider
            <select value={provider} onChange={e => setProvider(e.target.value)}>
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          {currentProvider && <small style={{ display: "block", opacity: 0.7, marginTop: -8, marginBottom: 8 }}>{currentProvider.note}</small>}
          <label>Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Production AI" /></label>
          <label>API key<input type="password" autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Stored once, never displayed" /></label>
          {provider === "custom" && <label>HTTPS base URL<input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" /></label>}
          <label>Model allowlist (optional)<input value={models} onChange={e => setModels(e.target.value)} placeholder="e.g. gpt-4o-mini, claude-sonnet-4 — leave blank to allow all" /></label>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }} className={styles.inlineActions}>
            <button onClick={testBeforeSave} disabled={busy || !organization || !apiKey}>Test before save</button>
            <button onClick={save} disabled={busy || !organization || !apiKey}>{busy ? "Securing…" : "Encrypt and save"}</button>
          </div>
        </article>
        <article className={styles.card}>
          <span>ACTIVE CONNECTIONS</span>
          <h2>Provider governance</h2>
          <p>Test, rotate, revoke, or discover the live model catalog for each stored provider without exposing secret values.</p>
          <div className={styles.list}>
            {items.length ? items.map(item => {
              const modelInfo = modelState[item.id];
              const testInfo = testState[item.id];
              const isExpanded = expanded === item.id && !!modelInfo;
              return (
                <div key={item.id}>
                  <div>
                    <b>{item.display_name}</b>
                    <small>{item.provider} · •••• {item.key_hint || "hidden"}{item.base_url ? ` · ${item.base_url}` : ""}</small>
                    <small>{item.model_allowlist?.length ? `Allowlist: ${item.model_allowlist.join(", ")}` : "All models allowed"}</small>
                    {modelInfo && <small>{modelInfo.error ? `⚠ ${modelInfo.error}` : `${modelInfo.count} models discovered · ${new Date(modelInfo.loadedAt).toLocaleTimeString()}`}</small>}
                    {testInfo && <small>{testInfo.ok ? "✓" : "⚠"} Last test {new Date(testInfo.at).toLocaleTimeString()}{testInfo.latencyMs ? ` · ${testInfo.latencyMs} ms` : ""} — {testInfo.message}</small>}
                    {item.rotated_at && <small>Rotated {new Date(item.rotated_at).toLocaleString()}</small>}
                  </div>
                  <em className={item.status === "active" ? styles.active : styles.revoked}>{item.status}</em>
                  <button onClick={() => test(item.id)} disabled={busy || item.status !== "active"}>Test</button>
                  <button onClick={() => void discover(item.id)} disabled={discovering === item.id || item.status !== "active"}>{discovering === item.id ? "Discovering…" : modelInfo ? `Refresh models` : `Discover models`}</button>
                  <button onClick={() => { setRotateId(item.id); setRotateKey(""); setError(""); }} disabled={busy || item.status !== "active"}>Rotate</button>
                  <button onClick={() => revoke(item.id)} disabled={busy || item.status !== "active"}>Revoke</button>
                  {rotateId === item.id && (
                    <div>
                      <label>New API key<input type="password" autoComplete="new-password" value={rotateKey} onChange={e => setRotateKey(e.target.value)} placeholder="Enter replacement secret" /></label>
                      <button onClick={rotate} disabled={busy || !rotateKey}>{busy ? "Rotating…" : "Confirm rotation"}</button>
                      <button onClick={() => { setRotateId(null); setRotateKey(""); }} disabled={busy}>Cancel</button>
                    </div>
                  )}
                  {isExpanded && modelInfo.models.length > 0 && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <b style={{ fontSize: 12, letterSpacing: ".08em" }}>DISCOVERED MODELS · {modelInfo.count}</b>
                        <button onClick={() => setExpanded(null)} style={{ fontSize: 12 }}>Collapse</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4, maxHeight: 240, overflowY: "auto", fontSize: 12 }}>
                        {modelInfo.models.slice(0, 200).map(model => (
                          <div key={model.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 6px", borderRadius: 4, background: "rgba(255,255,255,0.02)" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={model.id}>
                              <b>{model.label || model.id}</b>{model.label && model.label !== model.id && <span style={{ opacity: 0.55 }}> · {model.id}</span>}
                            </span>
                            <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              {model.free && <em style={{ padding: "1px 6px", borderRadius: 8, background: "#0e5c34", color: "#c7f3d6", fontStyle: "normal", fontSize: 10 }}>FREE</em>}
                              {model.vision && <em style={{ padding: "1px 6px", borderRadius: 8, background: "#38318a", color: "#dbd6ff", fontStyle: "normal", fontSize: 10 }}>VISION</em>}
                              {model.contextLength && <em style={{ padding: "1px 6px", borderRadius: 8, background: "#334155", color: "#e2e8f0", fontStyle: "normal", fontSize: 10 }}>{(model.contextLength / 1000).toFixed(0)}k</em>}
                            </span>
                          </div>
                        ))}
                        {modelInfo.models.length > 200 && <small style={{ padding: 4, opacity: 0.6 }}>Showing first 200 of {modelInfo.models.length}.</small>}
                      </div>
                    </div>
                  )}
                  {isExpanded && modelInfo.models.length === 0 && (
                    <div style={{ marginTop: 8, padding: 8, opacity: 0.7, fontSize: 12 }}>No models returned. The provider may require a key with model-listing scope or a specific base URL.</div>
                  )}
                </div>
              );
            }) : <div className={styles.empty}>No stored credentials. Add the first governed provider on the left.</div>}
          </div>
        </article>
      </section>
    </main>
  );
}
