import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { api, type ConfigView } from "../lib/api";
import { useToast } from "../components/Toast";
import { cn } from "../lib/utils";
import { T } from "../lib/motion";

type Key = keyof ConfigView;

interface FieldDef { key: Key; label: string; hint: string; secret: boolean; placeholder?: string }

interface Group { id: string; label: string; description: string; fields: FieldDef[] }

const GROUPS: Group[] = [
  {
    id: "github",
    label: "GitHub",
    description: "Auth + repo selection. Owner/repo auto-detect from git remote when blank.",
    fields: [
      { key: "GITHUB_TOKEN", label: "Personal Access Token", hint: "Requires repo + pull_requests scope.", secret: true, placeholder: "ghp_…" },
      { key: "GITHUB_OWNER", label: "Owner", hint: "Optional override.", secret: false, placeholder: "my-org" },
      { key: "GITHUB_REPO", label: "Repository", hint: "Optional override.", secret: false, placeholder: "my-repo" }
    ]
  },
  {
    id: "anthropic",
    label: "Anthropic / LLM",
    description: "Used for the optional LLM-enhanced pass in CI. The deterministic pipeline does not need this.",
    fields: [
      { key: "ANTHROPIC_API_KEY", label: "API key", hint: "Encrypted at rest with your WEB_SECRET_KEY.", secret: true, placeholder: "sk-ant-…" }
    ]
  },
  {
    id: "ollama",
    label: "Ollama (local models)",
    description: "Local model used by the VS Code chat agents. Not required for reviews from the web UI.",
    fields: [
      { key: "OLLAMA_MODEL", label: "Model", hint: "e.g. qwen3:4b, llama3.1:8b.", secret: false, placeholder: "qwen3:4b" },
      { key: "OLLAMA_URL", label: "URL", hint: "Base URL for the Ollama daemon.", secret: false, placeholder: "http://localhost:11434" }
    ]
  },
  {
    id: "misc",
    label: "Advanced",
    description: "Rarely changed.",
    fields: [
      { key: "MCP_SERVER_PORT", label: "MCP server port", hint: "HTTP bridge port. Default 3000.", secret: false, placeholder: "3000" }
    ]
  }
];

type TestState = "idle" | "loading" | "ok" | "fail";

export function Settings(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const config = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });

  const [values, setValues] = useState<Record<Key, string>>({} as Record<Key, string>);
  const [reveal, setReveal] = useState<Record<Key, boolean>>({} as Record<Key, boolean>);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    if (!config.data) return;
    const next = {} as Record<Key, string>;
    for (const g of GROUPS) for (const f of g.fields) {
      next[f.key] = f.secret ? "" : config.data.config[f.key].value;
    }
    setValues(next);
  }, [config.data]);

  const save = useMutation({
    mutationFn: (payload: Partial<Record<Key, string>>) => api.saveSettings(payload),
    onSuccess: async () => {
      toast.push("success", "Settings saved.");
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["prs"] });
      await qc.invalidateQueries({ queryKey: ["repo"] });
    },
    onError: (e: Error) => toast.push("error", e.message)
  });

  const test = useMutation({
    mutationFn: () => api.testSettings({
      GITHUB_TOKEN: values.GITHUB_TOKEN || undefined,
      GITHUB_OWNER: values.GITHUB_OWNER || undefined,
      GITHUB_REPO: values.GITHUB_REPO || undefined
    }),
    onMutate: () => { setTestState("loading"); setTestMessage(""); },
    onSuccess: (r) => {
      setTestState("ok");
      setTestMessage(`✓ ${r.user.login}${r.repo ? ` · ${r.repo.full_name}` : ""}`);
    },
    onError: (e: Error) => { setTestState("fail"); setTestMessage(e.message); }
  });

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const payload: Partial<Record<Key, string>> = {};
    for (const g of GROUPS) for (const f of g.fields) {
      const v = values[f.key];
      if (f.secret) {
        if (v && v.length > 0) payload[f.key] = v;
      } else {
        payload[f.key] = v ?? "";
      }
    }
    save.mutate(payload);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="telemetry text-fg-subtle mb-2">SETTINGS</div>
        <h1 className="font-display text-3xl font-semibold tracking-tightest text-fg">Configuration</h1>
        <p className="text-sm text-fg-muted mt-1">
          Secrets are AES-256-GCM encrypted at rest. Stored values are never sent back to the browser in clear text —
          only what you type here is ever revealed.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {GROUPS.map((g) => (
          <motion.section
            key={g.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={T.soft}
            className="card p-6"
          >
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="font-display text-lg font-semibold tracking-tightest text-fg">{g.label}</h2>
              <span className="telemetry text-fg-subtle">{g.id.toUpperCase()}</span>
            </div>
            <p className="text-xs text-fg-subtle mb-5">{g.description}</p>
            <div className="space-y-4">
              {g.fields.map((f) => {
                const status = config.data?.config[f.key];
                const showReveal = f.secret && reveal[f.key];
                return (
                  <div key={f.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-fg">{f.label}</label>
                      {status?.set ? (
                        <span className="telemetry text-sev-clean flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-sev-clean" /> STORED
                        </span>
                      ) : (
                        <span className="telemetry text-fg-subtle">NOT SET</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={f.secret && !showReveal ? "password" : "text"}
                        className="input flex-1 font-mono text-xs"
                        placeholder={f.secret && status?.set ? status.value : f.placeholder}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                        autoComplete="off"
                      />
                      {f.secret ? (
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          onClick={() => {
                            if (!reveal[f.key]) {
                              const ok = window.confirm(`Reveal ${f.label}? Only what you typed will be shown — the stored value stays masked.`);
                              if (!ok) return;
                            }
                            setReveal((s) => ({ ...s, [f.key]: !s[f.key] }));
                          }}
                        >
                          {showReveal ? "Hide" : "Reveal typed"}
                        </button>
                      ) : null}
                    </div>
                    <p className="text-xs text-fg-subtle">{f.hint}</p>
                  </div>
                );
              })}
            </div>
          </motion.section>
        ))}

        <div className="card p-4 flex items-center gap-3 sticky bottom-4 z-10 glass">
          <motion.button whileHover={{ y: -1 }} whileTap={{ y: 1 }} className="btn btn-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save settings"}
          </motion.button>
          <button
            className={cn(
              "btn transition-colors",
              testState === "ok" && "border-sev-clean/50 text-sev-clean",
              testState === "fail" && "border-sev-critical/50 text-sev-critical"
            )}
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={testState}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={T.micro}
                className="flex items-center gap-2"
              >
                {testState === "loading" ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-current animate-pulse" /> Testing…
                  </>
                ) : testState === "ok" ? (
                  <>✓ Connected</>
                ) : testState === "fail" ? (
                  <>✕ Failed</>
                ) : (
                  <>Test connection</>
                )}
              </motion.span>
            </AnimatePresence>
          </button>
          <AnimatePresence>
            {testMessage ? (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={cn(
                  "text-xs font-mono truncate",
                  testState === "ok" ? "text-sev-clean" : "text-sev-critical"
                )}
              >
                {testMessage}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </form>
    </div>
  );
}
