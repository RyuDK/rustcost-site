/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HashtagIcon } from "@heroicons/react/24/outline";
import type { JSX } from "react/jsx-runtime";
import {
  buildLanguagePrefix,
  normalizeLanguageCode,
} from "@/constants/language";
import type { LanguageCode } from "@/types/i18n";
import PageSEO from "@/shared/components/PageSEO";

type TocItem = { id: string; text: string; level: number };

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Replace <br>, <br/>, <br /> with actual line breaks in markdown
// Skips fenced code blocks to avoid altering code examples
function normalizeMd(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const trimmed = t.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(t);
      continue;
    }
    if (inFence) {
      out.push(t);
    } else {
      out.push(t.replace(/<br\s*\/?>(?=\s|$)/gi, "\n"));
    }
  }
  return out.join("\n");
}

const docFiles = import.meta.glob("../content/*/*.md", {
  query: "?raw",
  import: "default",
});

type DocCacheValue = {
  normalized: string;
  title?: string;
};

const docCache = new Map<string, Promise<DocCacheValue>>();

function loadDoc(fileKey: string): Promise<DocCacheValue> {
  const loader = docFiles[fileKey];
  if (!loader) {
    return Promise.reject(new Error("Doc not found for key: " + fileKey));
  }

  if (!docCache.has(fileKey)) {
    docCache.set(
      fileKey,
      (async () => {
        const raw = (await loader()) as string;
        const heading = /^\s*#\s+(.+)$/m.exec(raw)?.[1].trim();
        return {
          normalized: normalizeMd(raw),
          title: heading,
        };
      })()
    );
  }

  return docCache.get(fileKey)!;
}

export default function DocsPage() {
  type DocsParams = {
    ["lng"]?: LanguageCode;
    ["topic"]?: string;
  };
  const params = useParams<DocsParams>();
  const language = normalizeLanguageCode(params["lng"]);
  const currentTopic = params["topic"] ?? "index";
  const [content, setContent] = useState("");
  const [topics, setTopics] = useState<{ slug: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    type Item = {
      fileKey: string;
      slug: string;
      displaySlug: string;
      title: string;
      order: number;
    };

    const keys = Object.keys(docFiles).filter((k) =>
      k.startsWith(`../content/${language}/`)
    );

    const items: Item[] = keys.map((k) => {
      const filename = k.split("/").pop()!; // e.g., 001_overview.md
      const base = filename.replace(/\.md$/, "");
      let order = Number.POSITIVE_INFINITY;
      let displaySlug = base;

      const mOrder = /^(\d{2,3})[_-](.+)$/.exec(base);
      if (mOrder) {
        order = parseInt(mOrder[1], 10);
        displaySlug = mOrder[2];
      } else if (base === "index") {
        order = Number.NEGATIVE_INFINITY; // keep index at very top
        displaySlug = "index";
      }

      const fallbackTitle = displaySlug
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      return {
        fileKey: k,
        slug: base,
        displaySlug,
        title: fallbackTitle,
        order,
      };
    });

    items.sort((a, b) =>
      a.order === b.order ? a.title.localeCompare(b.title) : a.order - b.order
    );

    if (!cancelled) {
      setTopics(
        items.map(({ displaySlug, title }) => ({ slug: displaySlug, title }))
      );
    }

    const desired = currentTopic;
    const fallbackPath = `../content/${language}/${desired}.md`;
    let resolved = items.find((i) => i.displaySlug === desired)?.fileKey;
    if (!resolved && docFiles[fallbackPath]) {
      resolved = fallbackPath;
    }

    if (resolved && docFiles[resolved]) {
      loadDoc(resolved)
        .then((doc) => {
          if (!cancelled) {
            setContent(doc.normalized);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setContent(`# 404\nNot found: ${language}/${desired}`);
          }
        });
    } else {
      setContent(`# 404\nNot found: ${language}/${desired}`);
    }

    Promise.all(
      items.map(async ({ fileKey, displaySlug, title }) => {
        try {
          const doc = await loadDoc(fileKey);
          return { slug: displaySlug, title: doc.title ?? title };
        } catch {
          return { slug: displaySlug, title };
        }
      })
    ).then((loadedTopics) => {
      if (!cancelled) {
        setTopics(loadedTopics);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [language, currentTopic]);

  const toc: TocItem[] = useMemo(() => {
    const lines = content.split("\n");
    const items: TocItem[] = [];
    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (m) {
        const level = m[1].length;
        const text = m[2].replace(/`/g, "").trim();
        const id = slugify(text);
        items.push({ id, text, level });
      }
    }
    return items;
  }, [content]);

  useEffect(() => {
    const headings = Array.from(
      document.querySelectorAll("article h1, article h2, article h3")
    );
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-120px 0px -60% 0px", threshold: [0, 1] }
    );
    headings.forEach((h) => obs.observe(h));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      obs.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, [content]);

  const scrollToId = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  }, []);

  const headingStyles: Record<string, string> = {
    h1: "mt-12 mb-4 text-[32px] leading-[1.2] font-semibold text-gray-900 dark:text-gray-50",
    h2: "mt-10 mb-3 text-[26px] leading-[1.3] font-semibold text-gray-900 dark:text-gray-50",
    h3: "mt-8 mb-2.5 text-[21px] leading-[1.35] font-semibold text-gray-900 dark:text-gray-50",
    h4: "mt-7 mb-2 text-[18px] leading-[1.4] font-semibold text-gray-900 dark:text-gray-50",
  };

  const Heading =
    (tag: keyof JSX.IntrinsicElements) =>
    ({ children, className = "", ...props }: any) => {
      const text = String(children).replace(/<[^>]+>/g, "");
      const id = slugify(text);
      const T = tag as any;
      return (
        <T
          id={id}
          className={`group scroll-mt-28 ${headingStyles[tag]} ${className}`}
          {...props}
        >
          {children}
          <a
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToId(id);
            }}
            aria-label={`Link to ${text}`}
            className="ml-2 inline-flex align-middle text-gray-400 transition hover:text-blue-600 dark:hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 opacity-0 group-hover:opacity-100"
          >
            <HashtagIcon className="h-4 w-4" />
          </a>
        </T>
      );
    };

  const prefix = buildLanguagePrefix(language);
  const docsBasePath = `${prefix}/${"docs"}`;
  const buildDocPath = (slug?: string) =>
    slug && slug !== "index" ? `${docsBasePath}/${slug}` : docsBasePath;

  return (
    <div className="relative">
      <PageSEO
        titleKey="seo.docs.title"
        titleDefault="RustCost Documentation"
        descriptionKey="seo.docs.description"
        descriptionDefault="Install guides, architecture notes, and docs for RustCost."
      />
      <div className="mb-4 flex items-center justify-between lg:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-amber-500/60 dark:hover:bg-amber-900/30"
        >
          Menu
        </button>
        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Docs
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[250px_minmax(0,1fr)_220px]">
        <aside className="sticky top-24 hidden h-[calc(100vh-7rem)] select-none overflow-y-auto pr-3 lg:block">
          <nav className="space-y-1.5">
            {topics.map((t) => (
              <Link
                key={t.slug}
                to={buildDocPath(t.slug)}
                className={`flex items-center rounded-md border-l-2 px-3 py-2 text-[14px] font-medium transition ${
                  currentTopic === t.slug
                    ? "border-blue-600 bg-blue-50 text-blue-800 shadow-sm dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-100"
                    : "border-transparent text-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:text-gray-300 dark:hover:border-amber-500/60 dark:hover:bg-gray-800/70"
                }`}
              >
                {t.title}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <article className="max-w-4xl text-[15px] leading-[1.75] text-gray-800 antialiased dark:text-gray-100">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: Heading("h1"),
                h2: Heading("h2"),
                h3: Heading("h3"),
                h4: Heading("h4"),
                p({ children, ...rest }) {
                  return (
                    <p className="my-4 text-[15px] leading-[1.75]" {...rest}>
                      {children}
                    </p>
                  );
                },
                ul({ children, ...rest }) {
                  return (
                    <ul
                      className="my-4 space-y-2 pl-6 text-[15px] leading-[1.7] marker:text-gray-500 dark:marker:text-gray-400 list-disc"
                      {...rest}
                    >
                      {children}
                    </ul>
                  );
                },
                ol({ children, ...rest }) {
                  return (
                    <ol
                      className="my-4 space-y-2 pl-6 text-[15px] leading-[1.7] marker:text-gray-500 dark:marker:text-gray-400 list-decimal"
                      {...rest}
                    >
                      {children}
                    </ol>
                  );
                },
                li({ children, ...rest }) {
                  return (
                    <li className="pl-1 text-[15px] leading-[1.7]" {...rest}>
                      {children}
                    </li>
                  );
                },
                blockquote({ children, ...rest }) {
                  return (
                    <blockquote
                      className="my-6 border-l-4 border-blue-400 bg-blue-50/80 px-4 py-3 text-[15px] leading-[1.75] text-gray-900 italic shadow-sm dark:border-amber-500 dark:bg-amber-900/30 dark:text-gray-50"
                      {...rest}
                    >
                      {children}
                    </blockquote>
                  );
                },
                hr() {
                  return (
                    <hr className="my-10 border-t border-gray-200 dark:border-gray-800" />
                  );
                },
                code({ inline, className, children, ...rest }: any) {
                  const text = Array.isArray(children)
                    ? children.join("")
                    : String(children);

                  if (inline) {
                    return (
                      <code
                        className={`rounded-sm bg-blue-50 px-1.5 py-0.5 text-[13px] font-medium text-blue-800 dark:bg-amber-900/50 dark:text-amber-100 ${
                          className || ""
                        }`}
                        {...rest}
                      >
                        {children}
                      </code>
                    );
                  }

                  return (
                    <div className="not-prose relative my-6 overflow-hidden rounded-lg border border-gray-200 bg-gray-950 text-gray-100 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-[1.65]">
                        <code className={className} {...rest}>
                          {children}
                        </code>
                      </pre>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(text)}
                        className="absolute right-3 top-3 inline-flex items-center rounded-md border border-gray-500/40 bg-gray-900/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-100 shadow-sm transition hover:border-blue-400 hover:text-blue-100 dark:hover:border-amber-400 dark:hover:text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-amber-400"
                      >
                        Copy
                      </button>
                    </div>
                  );
                },
                table({ children }) {
                  return (
                    <div className="not-prose my-6 overflow-x-auto rounded-lg border border-gray-200 shadow-sm dark:border-gray-800">
                      <table className="w-full border-collapse text-left text-[14px] leading-[1.6] text-gray-800 dark:text-gray-100">
                        {children}
                      </table>
                    </div>
                  );
                },
                thead({ children, ...rest }) {
                  return (
                    <thead className="bg-gray-50 dark:bg-gray-800" {...rest}>
                      {children}
                    </thead>
                  );
                },
                tbody({ children, ...rest }) {
                  return <tbody {...rest}>{children}</tbody>;
                },
                tr({ children, ...rest }) {
                  return (
                    <tr
                      className="border-b border-gray-200 last:border-0 odd:bg-white even:bg-gray-50 dark:border-gray-800 dark:odd:bg-gray-900 dark:even:bg-gray-800/70"
                      {...rest}
                    >
                      {children}
                    </tr>
                  );
                },
                th({ children, ...rest }) {
                  return (
                    <th
                      className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-50"
                      {...rest}
                    >
                      {children}
                    </th>
                  );
                },
                td({ children, ...rest }) {
                  return (
                    <td
                      className="px-4 py-3 align-top text-sm text-gray-800 dark:text-gray-100"
                      {...rest}
                    >
                      {children}
                    </td>
                  );
                },
                img: ({ src, alt, title }: any) => (
                  <img
                    src={src}
                    alt={alt}
                    title={title}
                    loading="lazy"
                    className="my-6 mx-auto rounded-lg border border-gray-200 shadow-md transition hover:shadow-lg dark:border-gray-700"
                    onClick={() => setPreviewSrc(src)}
                  />
                ),
                a: ({ href, children, ...aProps }: any) => {
                  const url = String(href || "");
                  const classes =
                    "text-blue-600 underline decoration-[0.08em] underline-offset-[0.16em] transition hover:text-blue-700 dark:text-amber-300 dark:hover:text-amber-200";
                  if (/^https?:\/\//i.test(url)) {
                    return (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={classes}
                        {...aProps}
                      >
                        {children}
                      </a>
                    );
                  }
                  if (url.startsWith("./")) {
                    const slug = url.replace(/^\.\//, "").replace(/\.md$/, "");
                    const to = buildDocPath(slug);
                    return (
                      <Link to={to} className={classes} {...(aProps as any)}>
                        {children}
                      </Link>
                    );
                  }
                  return (
                    <a href={url} className={classes} {...aProps}>
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {(() => {
              const idx = topics.findIndex((t) => t.slug === currentTopic);
              const prev = idx > 0 ? topics[idx - 1] : null;
              const next =
                idx >= 0 && idx < topics.length - 1 ? topics[idx + 1] : null;
              if (!prev && !next) return null;
              return (
                <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 not-prose select-none">
                  {prev && (
                    <Link
                      to={buildDocPath(prev.slug)}
                      className="group inline-flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-amber-500/60 dark:hover:bg-amber-900/30"
                    >
                      <span className="text-lg leading-none text-blue-600 dark:text-amber-300">
                        ‹
                      </span>
                      {prev.title}
                    </Link>
                  )}
                  {next && (
                    <Link
                      to={buildDocPath(next.slug)}
                      className="group inline-flex w-fit items-center justify-self-end gap-2 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-amber-500/60 dark:hover:bg-amber-900/30"
                    >
                      {next.title}
                      <span className="text-lg leading-none text-blue-600 dark:text-amber-300">
                        ›
                      </span>
                    </Link>
                  )}
                </div>
              );
            })()}
          </article>
        </main>

        <aside className="sticky top-24 hidden h-[calc(100vh-7rem)] select-none overflow-y-auto pl-3 lg:block">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            On this page
          </div>
          <ul className="space-y-1.5 text-sm">
            {toc
              .filter((i) => i.level <= 3)
              .map((i, idx) => (
                <li
                  key={`${i.id}-${idx}`}
                  className={i.level > 2 ? "ml-3" : ""}
                >
                  <a
                    href={`#${i.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToId(i.id);
                    }}
                    className={`block rounded-md border-l-2 px-2 py-1 transition ${
                      activeId === i.id
                        ? "border-blue-600 bg-blue-50 text-blue-800 shadow-sm dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-100"
                        : "border-transparent text-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:text-gray-300 dark:hover:border-amber-500/60 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    {i.text}
                  </a>
                </li>
              ))}
          </ul>
        </aside>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute left-0 top-0 h-full w-72 bg-white p-4 shadow-xl dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
                Docs
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:text-gray-100 dark:hover:border-amber-500/60 dark:hover:bg-amber-900/30"
              >
                Close
              </button>
            </div>
            <nav className="space-y-1.5">
              {topics.map((t) => (
                <Link
                  key={t.slug}
                  to={buildDocPath(t.slug)}
                  onClick={() => setOpen(false)}
                  className={`block rounded-md border-l-2 px-3 py-2 text-sm font-medium transition ${
                    currentTopic === t.slug
                      ? "border-blue-600 bg-blue-50 text-blue-800 shadow-sm dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-100"
                      : "border-transparent text-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:text-gray-300 dark:hover:border-amber-500/60 dark:hover:bg-gray-800/70"
                  }`}
                >
                  {t.title}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewSrc(null)}
        >
          <img
            src={previewSrc}
            alt="preview"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
