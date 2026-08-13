import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PipelineDiagram } from "../components/PipelineDiagram";
import { T, stagger } from "../lib/motion";

const ENTRY_POINTS = [
  {
    icon: "💬",
    title: "VS Code chat agents",
    lead: "Conversational",
    body: "Pick Orchestrator (or a single specialist) in the chat mode dropdown and ask for “review PR #42”. The model only routes the call — #run_pr_review does the work.",
    foot: ".github/agents/*.agent.md"
  },
  {
    icon: "⌨️",
    title: "VS Code tasks · CLI · CI",
    lead: "Deterministic",
    body: "Tasks: Run Task → pr-agent.reviewCurrent, or call the CLI directly. The same binary backs the GitHub Actions workflow on every push to a PR.",
    foot: "node mcp-server/dist/cli.js reviewCurrent 42"
  },
  {
    icon: "🖥️",
    title: "This web dashboard",
    lead: "Visual",
    body: "Browse open and closed PRs, read the diff, run a full review or one agent, and watch each agent flip state live over SSE as it actually starts and finishes.",
    foot: "web/server → orchestrator.runReview"
  }
];

export function Home(): JSX.Element {
  return (
    <div className="space-y-20 md:space-y-24">
      <Hero />
      <Explainer />

      <section className="space-y-6">
        <SectionHeading
          tag="PIPELINE"
          title="One run, end to end"
          lead="Every entry point converges on the same orchestrator. This is the actual flow — fan out to three agents, merge, then fan out again into four outputs."
        />
        <PipelineDiagram />
      </section>

      <HowToUse />
      <SecurityCallout />
      <ClosingCta />
    </div>
  );
}

function Hero(): JSX.Element {
  return (
    <section className="hero-glow hero-grid relative pt-6 pb-4">
      <motion.div initial="initial" animate="animate" variants={stagger(0.06)} className="max-w-3xl">
        <motion.div variants={fade} transition={T.soft} className="telemetry text-fg-subtle mb-4">
          MULTI-AGENT PULL REQUEST REVIEW
        </motion.div>

        <motion.h1
          variants={fade}
          transition={T.soft}
          className="font-display text-4xl md:text-6xl font-semibold tracking-tightest leading-[1.03] text-fg"
        >
          Three specialists.<br />
          One review comment.
        </motion.h1>

        <motion.p variants={fade} transition={T.soft} className="text-fg-muted mt-5 text-base md:text-lg max-w-2xl leading-relaxed">
          An Orchestrator runs Summary, Security, and Documentation agents in parallel over a
          pull request&apos;s diff, merges their findings into one report, and posts it back to
          GitHub — as a single comment it keeps editing in place, plus inline notes on the
          exact lines that caused the worst findings.
        </motion.p>

        <motion.div variants={fade} transition={T.soft} className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/dashboard" className="btn btn-primary">
            Open Dashboard
            <span aria-hidden="true">→</span>
          </Link>
          <Link to="/reports" className="btn">
            View Reports
          </Link>
        </motion.div>

        <motion.div variants={fade} transition={T.soft} className="mt-7 flex flex-wrap items-center gap-2">
          <span className="chip">📋 Summary</span>
          <span className="chip">🔒 Security</span>
          <span className="chip">📚 Documentation</span>
          <span className="chip border-dashed">🤖 LLM pass · optional</span>
        </motion.div>
      </motion.div>
    </section>
  );
}

function Explainer(): JSX.Element {
  const steps = [
    {
      n: "01",
      title: "Fan out",
      body: "The Orchestrator makes one GitHub fetch for the PR — metadata, files, diff, commits — then hands that same context to all three agents at once."
    },
    {
      n: "02",
      title: "Merge",
      body: "Each agent returns the same envelope: a risk level, a markdown section, and (for Security) structured findings anchored to file:line. The merge step assembles one canonical document."
    },
    {
      n: "03",
      title: "Deliver",
      body: "One comment is upserted on the PR, high and critical findings go inline on the diff, the report lands in docs/pr-reviews/, and one metrics row is appended for the trends view."
    }
  ];

  return (
    <section className="space-y-6">
      <SectionHeading
        tag="WHAT IT IS"
        title="A review pipeline, not a chatbot"
        lead="The review logic is deterministic TypeScript. An LLM is only ever a router deciding which tool to call — which is why the same PR produces the same report from chat, from CI, and from this dashboard."
      />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={stagger(0.08)}
        className="grid gap-4 md:grid-cols-3"
      >
        {steps.map((s) => (
          <motion.div key={s.n} variants={fadeCard} transition={T.soft} className="card p-5 relative overflow-hidden">
            <span className="absolute right-4 top-3 font-display text-4xl font-semibold text-fg-subtle/15 tabular-nums select-none">
              {s.n}
            </span>
            <h3 className="font-display font-semibold text-fg tracking-tightest">{s.title}</h3>
            <p className="text-sm text-fg-muted mt-2 leading-relaxed">{s.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function HowToUse(): JSX.Element {
  return (
    <section className="space-y-6">
      <SectionHeading
        tag="HOW TO USE IT"
        title="Three entry points, one result"
        lead="All three call the same orchestrator code, so the output is byte-identical no matter where you start the run."
      />
      <motion.div
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={stagger(0.08)}
        className="grid gap-4 md:grid-cols-3"
      >
        {ENTRY_POINTS.map((e) => (
          <motion.div
            key={e.title}
            variants={fadeCard}
            transition={T.soft}
            whileHover={{ y: -2 }}
            className="card p-5 flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-bg-2 border border-line grid place-items-center text-lg">
                {e.icon}
              </span>
              <div className="min-w-0">
                <div className="telemetry text-fg-subtle">{e.lead}</div>
                <h3 className="font-medium text-fg truncate">{e.title}</h3>
              </div>
            </div>
            <p className="text-sm text-fg-muted leading-relaxed flex-1">{e.body}</p>
            <code className="text-[11px] font-mono text-fg-subtle bg-bg-2 border border-line rounded-md px-2 py-1.5 block overflow-x-auto whitespace-nowrap">
              {e.foot}
            </code>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function SecurityCallout(): JSX.Element {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={T.page}
      className="card p-6 md:p-8 relative overflow-hidden"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-sev-critical via-sev-high to-transparent"
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <div className="telemetry text-fg-subtle mb-3">SECURITY SCANNING</div>
          <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tightest text-fg">
            Two layers, one section
          </h2>
          <p className="text-sm text-fg-muted mt-3 leading-relaxed">
            You never chase findings across two tools. Everything lands under{" "}
            <code className="font-mono text-fg text-[0.85em]">## 🔒 Security Analysis</code> with a
            single recomputed risk level.
          </p>
          <div className="mt-5 flex flex-wrap gap-1.5">
            <span className="chip text-sev-clean border-sev-clean/40 bg-sev-clean/10">clean</span>
            <span className="chip text-sev-low border-sev-low/40 bg-sev-low/10">low</span>
            <span className="chip text-sev-medium border-sev-medium/40 bg-sev-medium/10">medium</span>
            <span className="chip text-sev-high border-sev-high/40 bg-sev-high/10">high</span>
            <span className="chip text-sev-critical border-sev-critical/40 bg-sev-critical/10">critical</span>
          </div>
        </div>

        <div className="space-y-3">
          <LayerRow
            tag="LAYER 1 · ALWAYS ON"
            title="Built-in regex engine"
            body="18 vulnerability categories — secrets, injection, XSS, SSRF, weak crypto, path traversal and more — plus a Shannon-entropy check for unknown credential shapes. Zero dependencies, works offline, honors // pr-agent-ignore, dampens severity in test files."
            tone="clean"
          />
          <LayerRow
            tag="LAYER 2 · AUTOMATIC"
            title="Semgrep · Gitleaks · Trivy"
            body="Real scanners run in Docker against the PR's files at the head commit, and their SARIF is folded into the same findings list — scoped to changed files, deduped, capped. If Docker is down, the section says so and Layer 1 carries the review."
            tone="medium"
          />
        </div>
      </div>
    </motion.section>
  );
}

function LayerRow({
  tag,
  title,
  body,
  tone
}: {
  tag: string;
  title: string;
  body: string;
  tone: "clean" | "medium";
}): JSX.Element {
  const accent = tone === "clean" ? "text-sev-clean" : "text-sev-medium";
  const dot = tone === "clean" ? "bg-sev-clean" : "bg-sev-medium";
  return (
    <div className="card-quiet p-4">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={`telemetry ${accent}`}>{tag}</span>
      </div>
      <h3 className="font-medium text-fg mt-2">{title}</h3>
      <p className="text-sm text-fg-muted mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function ClosingCta(): JSX.Element {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={T.page}
      className="hero-glow relative card p-8 md:p-10 text-center"
    >
      <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tightest text-fg">
        Ready to review something?
      </h2>
      <p className="text-sm text-fg-muted mt-3 max-w-xl mx-auto leading-relaxed">
        The dashboard lists every open and closed pull request on the detected repository. Pick
        one, run the agents, and watch the pipeline above happen for real.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link to="/dashboard" className="btn btn-primary">
          Open Dashboard
          <span aria-hidden="true">→</span>
        </Link>
        <Link to="/settings" className="btn">
          Configure tokens
        </Link>
      </div>
    </motion.section>
  );
}

function SectionHeading({
  tag,
  title,
  lead
}: {
  tag: string;
  title: string;
  lead: string;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={T.soft}
      className="max-w-2xl"
    >
      <div className="telemetry text-fg-subtle mb-3">{tag}</div>
      <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tightest text-fg">
        {title}
      </h2>
      <p className="text-sm text-fg-muted mt-3 leading-relaxed">{lead}</p>
    </motion.div>
  );
}

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 }
};

const fadeCard = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 }
};
