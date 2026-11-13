import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sections = ['目的・期待する結果', '変更内容と理由', '検証結果', 'レビューしてほしい点', '影響・未確認事項'];
const types = 'build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test';

export function parseCommitIssue(message, { allowAutosquash = true } = {}) {
  if (typeof message !== 'string') return null;
  const text = message.replace(/\n+$/, '');
  if (/[\r\n]/.test(text)) return null;
  const prefix = allowAutosquash ? '(?:(?:fixup!|squash!|amend!) )?' : '';
  const match = text.match(new RegExp(`^${prefix}(?:${types})\\(#([1-9][0-9]*)\\)!?: \\S(?:.*\\S)?$`));
  return match?.[1] ?? null;
}

function readSections(body) {
  const found = new Map();
  const problems = [];
  let current = null;
  let fence = null;
  const text = body.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (const line of text.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (current) found.get(current).push(line);
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      if (current) found.get(current).push(line);
      continue;
    }
    const heading = line.match(/^ {0,3}##[ \t]+(.+?)[ \t]*#*[ \t]*$/)?.[1];
    if (heading) {
      current = sections.includes(heading) ? heading : null;
      if (current && found.has(current)) {
        problems.push(`「${current}」が重複しています。`);
        current = null;
      } else if (current) found.set(current, []);
    } else if (current) found.get(current).push(line);
  }
  for (const name of sections) {
    const content = (found.get(name) ?? []).join('\n')
      .replace(/^\s*(`{3,}|~{3,}).*$/gm, '')
      .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?/gm, '').trim();
    if (!content || /^[\s#>*_\[\]`~.。…-]*$/.test(content) || /^(TODO|TBD|未記入)$/i.test(content)) {
      problems.push(`「${name}」を記入してください。コメントや記入例だけでは通りません。`);
    } else if (sections.indexOf(name) < 3 && /^(N\/A|なし|該当なし|特記なし)[。.!！\s]*$/i.test(content)) {
      problems.push(`「${name}」は省略せず、具体的に記入してください。`);
    }
  }
  return problems;
}

export function validatePullRequest(pr, { repository, expectedHead }) {
  const problems = [];
  if (pr.headRefOid !== expectedHead) problems.push('PR の HEAD が変わりました。最新の実行を再実行してください。');
  const linked = new Set((pr.linkedIssues ?? [])
    .filter((issue) => issue.repository?.nameWithOwner?.toLowerCase() === repository.toLowerCase())
    .map((issue) => String(issue.number)));
  if (!linked.size) problems.push('Development 欄にこのリポジトリの Issue を紐づけてください。本文の #番号だけでは代用できません。紐づけ後は最新の CI を再実行してください。');
  const titleIssue = parseCommitIssue(pr.title, { allowAutosquash: false });
  if (!titleIssue) problems.push('PR タイトルは type(#123): 説明 の1行にしてください。');
  else if (!linked.has(titleIssue)) problems.push(`PR タイトルの Issue #${titleIssue} が Development に紐づいていません。`);
  if (!Array.isArray(pr.commits) || !pr.commits.length) problems.push('新規コミットを取得できません。');
  for (const commit of pr.commits ?? []) {
    const issue = parseCommitIssue(commit.message);
    const id = String(commit.oid ?? '').slice(0, 7);
    if (!issue) problems.push(`コミット ${id} は Issue 番号付きの1行形式ではありません。`);
    else if (!linked.has(issue)) problems.push(`コミット ${id} の Issue #${issue} が Development に紐づいていません。`);
  }
  problems.push(...readSections(typeof pr.body === 'string' ? pr.body : ''));
  return problems;
}

const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
  repository(owner:$owner,name:$name) { pullRequest(number:$number) {
    title body headRefOid updatedAt
    closingIssuesReferences(first:100,after:$cursor) {
      nodes { number repository { nameWithOwner } }
      pageInfo { hasNextPage endCursor }
    }
  } }
}`;

function requestGraphql(input) {
  try {
    return JSON.parse(execFileSync('gh', ['api', 'graphql', '--input', '-'], {
      input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } catch {
    throw new Error('GitHub の PR 情報を取得できません。通信・認証・読み取り権限を確認してください。');
  }
}

export async function loadPullRequest({ repository, number, expectedHead, request = requestGraphql }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('リポジトリ名または PR 番号が不正です。');
  }
  const [owner, name] = repository.split('/');
  const linkedIssues = [];
  const seen = new Set();
  let cursor = null;
  let snapshot = null;
  do {
    const payload = await request({ query, variables: { owner, name, number, cursor } });
    if (payload?.errors?.length) throw new Error('GitHub API がエラーを返しました。部分的な取得結果では判定しません。');
    const pr = payload?.data?.repository?.pullRequest;
    const connection = pr?.closingIssuesReferences;
    if (!pr || !connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('GitHub API の応答が不完全です。Issue の紐づけを確認できません。');
    }
    if (pr.headRefOid !== expectedHead) throw new Error('PR の HEAD が変わりました。最新の CI を再実行してください。');
    if (snapshot && (pr.updatedAt !== snapshot.updatedAt || pr.title !== snapshot.title || pr.body !== snapshot.body)) {
      throw new Error('取得中に PR が更新されました。CI を再実行してください。');
    }
    snapshot ??= pr;
    for (const issue of connection.nodes) {
      if (!Number.isSafeInteger(issue?.number) || issue.number < 1 || typeof issue.repository?.nameWithOwner !== 'string') {
        throw new Error('GitHub API の Issue 情報が不完全です。');
      }
      linkedIssues.push(issue);
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw new Error('GitHub API のページ取得が完了しません。');
    seen.add(cursor);
  } while (true);
  return { title: snapshot.title, body: snapshot.body, headRefOid: snapshot.headRefOid, linkedIssues };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER);
  const expectedHead = process.env.HEAD_SHA;
  const base = process.env.BASE_SHA;
  const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  if (!oidPattern.test(expectedHead ?? '') || !oidPattern.test(base ?? '')) throw new Error('BASE_SHA / HEAD_SHA が不正です。');
  const pr = await loadPullRequest({ repository, number, expectedHead });
  // 引数はシェルに展開せず、実際の PR の分岐点以降の全コミットを検査する。
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();
  const sharedBase = git('merge-base', base, expectedHead);
  const ids = git('rev-list', `${sharedBase}..${expectedHead}`).split('\n').filter(Boolean);
  pr.commits = ids.map((oid) => ({ oid, message: git('show', '--no-patch', '--no-notes', '--format=%B', oid) }));
  const problems = validatePullRequest(pr, { repository, expectedHead });
  if (problems.length) throw new Error(problems.join('\n'));
  console.log('PR policy: Development の Issue 紐づけ・コミット・本文が検査に通りました。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`PR policy: ${error.message}`);
    process.exitCode = 1;
  });
}
