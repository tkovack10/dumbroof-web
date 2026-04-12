import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const recId = parseInt(id, 10);
  if (isNaN(recId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const userSb = await createClient();
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: admin } = await userSb.from("admins").select("user_id").eq("user_id", user.id).limit(1);
  if (!admin?.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: rec, error: fetchErr } = await supabaseAdmin
    .from("agent_recommendations")
    .select("*")
    .eq("id", recId)
    .limit(1);

  if (fetchErr || !rec?.length) {
    return NextResponse.json({ error: "recommendation not found" }, { status: 404 });
  }

  const recommendation = rec[0];
  if (recommendation.status !== "pending" && recommendation.status !== "deferred") {
    return NextResponse.json({ error: `already ${recommendation.status}` }, { status: 400 });
  }

  // Create GitHub PR via GitHub API
  let prUrl: string | null = null;
  let branchName: string | null = null;
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPO || "tkovack10/dumbroof-web";

  if (ghToken && recommendation.proposed_diff) {
    try {
      const result = await createGithubPr({
        token: ghToken,
        repo,
        agent: recommendation.agent,
        recId,
        targetPath: recommendation.target_path,
        summary: recommendation.summary,
        rationale: recommendation.rationale || "",
        diff: recommendation.proposed_diff,
      });
      prUrl = result.prUrl;
      branchName = result.branch;
    } catch (err) {
      console.error("[agent-rec] GitHub PR creation failed:", err);
    }
  }

  await supabaseAdmin
    .from("agent_recommendations")
    .update({
      status: "approved",
      reviewed_by: user.email || user.id,
      reviewed_at: new Date().toISOString(),
      github_pr_url: prUrl,
      github_branch: branchName,
    })
    .eq("id", recId);

  return NextResponse.json({
    success: true,
    pr_url: prUrl,
    branch: branchName,
    note: prUrl ? "PR created — review and merge on GitHub" : "Approved but GitHub PR creation failed (check GITHUB_TOKEN env var)",
  });
}

async function createGithubPr(args: {
  token: string;
  repo: string;
  agent: string;
  recId: number;
  targetPath: string;
  summary: string;
  rationale: string;
  diff: string;
}): Promise<{ prUrl: string; branch: string }> {
  const { token, repo, agent, recId, targetPath, summary, rationale, diff } = args;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const api = `https://api.github.com/repos/${repo}`;

  // Get default branch SHA
  const refRes = await fetch(`${api}/git/ref/heads/main`, { headers });
  if (!refRes.ok) throw new Error(`Failed to get main ref: ${refRes.status}`);
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // Create branch
  const branch = `agent/${agent}-${recId}`;
  const branchRes = await fetch(`${api}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (!branchRes.ok && (await branchRes.text()).includes("Reference already exists")) {
    // Branch exists — continue with PR creation
  } else if (!branchRes.ok) {
    throw new Error(`Failed to create branch: ${branchRes.status}`);
  }

  // Create a commit with the diff as the commit message body
  // (We can't apply a raw diff via the GitHub API easily, so we put the
  // proposed diff in a new file that the human reviewer applies manually)
  const diffContent = Buffer.from(
    `# Agent Recommendation #${recId}\n\n` +
    `## Summary\n${summary}\n\n` +
    `## Rationale\n${rationale}\n\n` +
    `## Target\n\`${targetPath}\`\n\n` +
    `## Proposed Diff\n\`\`\`diff\n${diff}\n\`\`\`\n`
  ).toString("base64");

  const createFileRes = await fetch(`${api}/contents/.agent-recommendations/${recId}.md`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `[${agent}] ${summary}`,
      content: diffContent,
      branch,
    }),
  });
  if (!createFileRes.ok) {
    throw new Error(`Failed to create file: ${createFileRes.status}`);
  }

  // Create PR
  const prRes = await fetch(`${api}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `[${agent}] ${summary}`,
      body: `## Agent Recommendation #${recId}\n\n**Agent:** ${agent}\n**Target:** \`${targetPath}\`\n\n### Rationale\n${rationale}\n\n### Proposed Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n---\n*Auto-generated by DumbRoof agent system. Review the diff above, apply it to the target file, and merge.*\n\nReview queue: https://www.dumbroof.ai/admin/agent-recommendations`,
      head: branch,
      base: "main",
    }),
  });
  if (!prRes.ok) {
    const errBody = await prRes.text();
    throw new Error(`Failed to create PR: ${prRes.status} ${errBody}`);
  }
  const prData = (await prRes.json()) as { html_url: string };

  return { prUrl: prData.html_url, branch };
}
