"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";
import { sanitizeMermaidSource } from "./mermaid-utils";
import { useT } from "@/lib/i18n";

let mermaidRenderQueue: Promise<void> = Promise.resolve();
let mermaidInitializedTheme: "default" | "dark" | null = null;
let mermaidRenderSequence = 0;

export function runMermaidRender<T>(task: () => Promise<T>): Promise<T> {
	const run = mermaidRenderQueue.then(task, task);
	mermaidRenderQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

export function removeMermaidRenderArtifacts(renderId: string) {
	if (typeof document === "undefined") return;

	document.querySelectorAll(`[id="${renderId}"]`).forEach((node) => {
		const element = node as HTMLElement;
		if (!element.closest(".markdown-content")) {
			element.remove();
		}
	});
}

export function MermaidBlock({
	chart,
	deferErrors,
}: {
	chart: string;
	deferErrors: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const t = useT();
	const reactId = useId();
	const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		let activeRenderId: string | null = null;
		let errorTimer: ReturnType<typeof setTimeout> | null = null;

		async function renderDiagram() {
			setError(null);

			try {
				await runMermaidRender(async () => {
					if (cancelled) return;

					const mermaid = (await import("mermaid")).default;
					const theme = resolvedTheme === "dark" ? "dark" : "default";
					if (mermaidInitializedTheme !== theme) {
						mermaid.initialize({
							startOnLoad: false,
							securityLevel: "strict",
							theme,
						});
						mermaidInitializedTheme = theme;
					}

					if (cancelled) return;

					activeRenderId = `${renderId}-${Date.now().toString(36)}-${mermaidRenderSequence++}`;
					const cleanChart = sanitizeMermaidSource(chart);
					const result = await mermaid.render(activeRenderId, cleanChart);
					removeMermaidRenderArtifacts(activeRenderId);
					if (!cancelled) {
						setSvg(result.svg);
					}
				});
			} catch (err) {
				if (!cancelled) {
					if (deferErrors) return;

					const message =
						err instanceof Error ? err.message : "Invalid Mermaid syntax";
					errorTimer = setTimeout(() => {
						if (!cancelled) {
							setError(message);
						}
					}, 600);
				}
			} finally {
				if (activeRenderId) {
					removeMermaidRenderArtifacts(activeRenderId);
				}
			}
		}

		void renderDiagram();

		return () => {
			cancelled = true;
			if (errorTimer) {
				clearTimeout(errorTimer);
			}
			if (activeRenderId) {
				removeMermaidRenderArtifacts(activeRenderId);
			}
		};
	}, [chart, deferErrors, renderId, resolvedTheme]);

	useEffect(() => {
		if (svg && containerRef.current) {
			const parser = new DOMParser();
			const doc = parser.parseFromString(svg, "text/html");
			const svgElement = doc.body.firstChild;
			if (svgElement) {
				containerRef.current.replaceChildren(svgElement);
			}
		}
	}, [svg]);

	if (error) {
		return (
			<div className="my-2 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3">
				<p className="mb-2 text-xs font-medium text-red-700 dark:text-red-300">
					Unable to render Mermaid diagram: {error}
				</p>
				<pre className="overflow-x-auto text-[13px] leading-relaxed font-mono text-red-950 dark:text-red-100">
					<code>{chart}</code>
				</pre>
			</div>
		);
	}

	if (!svg) {
		return (
			<div className="my-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs text-muted-foreground">
				{t("chat.renderingDiagram")}
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="my-2 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 [&_svg]:mx-auto [&_svg]:max-w-full"
		/>
	);
}
