import fs from "fs";
import path from "path";
import process from "process";
import { Octokit } from "@octokit/rest";

const token = process.env.GITHUB_TOKEN;
const repoFull = process.env.REPO; // owner/repo
const issueNumber = Number(process.env.ISSUE_NUMBER);

if (!token || !repoFull || !issueNumber) {
  console.error("Missing env: GITHUB_TOKEN, REPO, ISSUE_NUMBER");
  process.exit(1);
}

const [owner, repo] = repoFull.split("/");
const octokit = new Octokit({ auth: token });

const MARKER = "<!-- pm-assistant:checklist -->";

function pickTemplate(issue) {
  const labels = (issue.labels || []).map(l => (typeof l === "string" ? l : l.name));
  if (labels.includes("type:new-build")) return "checklist-new-build.md";
  if (labels.includes("type:change")) return "checklist-change.md";

  // fallback: title heuristic
  const t = (issue.title || "").toLowerCase();
  if (t.includes("신규") || t.includes("new")) return "checklist-new-build.md";
  return "checklist-change.md";
}

function detectPII(issueBody = "") {
  // Issue form body contains the selected text; we just search keywords.
  return /개인정보|PII|문의|신청|이벤트|뉴스레터/.test(issueBody);
}

async function main() {
  const { data: issue } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  const body = issue.body || "";

  // avoid duplicate comment
  const { data: comments } = await octokit.issues.listComments({ owner, repo, issue_number: issueNumber, per_page: 100 });
  const already = comments.some(c => (c.body || "").includes(MARKER));
  if (already) return;

  const templateName = pickTemplate(issue);
  const templatePath = path.join(process.cwd(), "templates", templateName);
  const template = fs.readFileSync(templatePath, "utf-8");

  const piiFlag = detectPII(body);
  const piiNote = piiFlag
    ? "\n> ⚠️ **개인정보(PII) 가능성 감지**: 법무/보안/개인정보 처리(수집항목·보관기간·처리위탁·파기) 체크를 우선 포함하세요.\n"
    : "";

  const comment =
`${MARKER}
👋 PM 자동 체크리스트를 생성했어요. (이 이슈를 “작업 허브”로 사용)

${piiNote}
${template}

---

### 📌 추천 운영 방식
- 이슈 본문 = 요구사항/결정사항 로그
- 댓글 = 진행상태/리스크/결정 히스토리
- 완료 조건 = 체크리스트 “오픈/운영이관” 항목까지 체크 후 Close
`;

  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body: comment });

  // add labels automatically (PII)
  if (piiFlag) {
    const existing = (issue.labels || []).map(l => (typeof l === "string" ? l : l.name));
    if (!existing.includes("risk:pii")) {
      await octokit.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: ["risk:pii"] });
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
