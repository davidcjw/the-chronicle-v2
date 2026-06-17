import fetch from "node-fetch";
import config from "../../dashboard.config.js";

const cfg = config.gitlab || {};
const maxMRs = cfg.maxMRs || 20;

function gitlabFetch(path) {
  const base = process.env.GITLAB_URL.replace(/\/$/, "");
  return fetch(`${base}/api/v4${path}`, {
    headers: { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN },
  });
}

async function getUnresolvedCount(projectId, mrIid) {
  let page = 1;
  let allDiscussions = [];
  while (true) {
    const res = await gitlabFetch(
      `/projects/${projectId}/merge_requests/${mrIid}/discussions?per_page=100&page=${page}`
    );
    if (!res.ok) return null;
    const discussions = await res.json();
    allDiscussions = allDiscussions.concat(discussions);
    if (discussions.length < 100) break;
    page++;
  }
  return allDiscussions.filter((d) =>
    d.notes?.some((n) => n.resolvable === true && n.resolved === false)
  ).length;
}

async function getMRs(req, res) {
  try {
    const response = await gitlabFetch(
      `/merge_requests?state=opened&scope=created_by_me&per_page=${maxMRs}`
    );
    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: body });
    }

    const mrs = await response.json();

    // Fetch unresolved discussion counts in parallel
    const enriched = await Promise.all(
      mrs.map(async (mr) => {
        const unresolved = await getUnresolvedCount(mr.project_id, mr.iid);
        return {
          id: mr.id,
          iid: mr.iid,
          title: mr.title,
          url: mr.web_url,
          project: mr.references?.full?.split("!")?.[0] || mr.project_id,
          targetBranch: mr.target_branch,
          draft: mr.draft,
          createdAt: mr.created_at,
          unresolvedThreads: unresolved,
        };
      })
    );

    res.json({ mrs: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default {
  id: "gitlab",
  label: "GitLab MRs",
  env: ["GITLAB_TOKEN", "GITLAB_URL"],
  routes: [{ method: "GET", path: "/api/gitlab/mrs", handler: getMRs }],
};
