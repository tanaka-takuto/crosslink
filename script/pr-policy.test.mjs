import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPullRequest, parseCommitIssue, validatePullRequest } from './pr-policy.mjs';

const repository = 'tanaka-takuto/crosslink';
const head = 'a'.repeat(40);
const body = `## 目的・期待する結果
変更と Issue を追跡できるようにする。
## 変更内容と理由
Development の実リンクを API で確認する。
## 検証結果
テストを実行して拒否と受理を確認した。
## レビューしてほしい点
API の取得失敗時に検査を通さないこと。
## 影響・未確認事項
本体の実行結果への影響はない。開発運用のみ変更する。`;

function fixture() {
  return {
    title: 'ci(#123): PR の追跡を必須にする',
    body,
    headRefOid: head,
    linkedIssues: [{ number: 123, repository: { nameWithOwner: repository } }],
    commits: [{ oid: head, message: 'ci(#123): PR の追跡を必須にする' }],
  };
}

function errors(pr) {
  return validatePullRequest(pr, { repository, expectedHead: head });
}

test('Closes の文字列がなくても Development の実リンクがあれば通る', () => {
  assert.deepEqual(errors(fixture()), []);
});

for (const message of [
  'fix: Issue なし', 'fix(cli): Issue なし', 'fix(#0): 不正',
  'fix(#01): 不正', 'fix(#-1): 不正', 'fix(#abc): 不正',
  'Merge pull request #123 from branch', 'fix(#123): ',
  'fix(#123): 件名\n\n本文',
]) {
  test(`不正なコミットを拒否: ${JSON.stringify(message)}`, () => {
    assert.equal(parseCommitIssue(message), null);
  });
}

test('日本語・破壊的変更・fixup の Issue 番号を認識する', () => {
  assert.equal(parseCommitIssue('feat(#123)!: 出力形式を変更する'), '123');
  assert.equal(parseCommitIssue('fixup! fix(#123): 追加修正する'), '123');
});

test('本文の Closes や #番号だけでは実リンクを代用できない', () => {
  const pr = fixture();
  pr.linkedIssues = [];
  pr.body += '\nCloses #123\n関連: #123';
  assert.match(errors(pr).join('\n'), /Development/);
});

test('別リポジトリの Issue だけでは通さない', () => {
  const pr = fixture();
  pr.linkedIssues[0].repository.nameWithOwner = 'other/repository';
  assert.match(errors(pr).join('\n'), /Development/);
});

test('タイトルと各コミットの番号が実リンクに含まれることを検査する', () => {
  const pr = fixture();
  pr.title = 'fix(#456): 別の Issue';
  pr.commits.push({ oid: 'b'.repeat(40), message: 'fix(#789): 別の Issue' });
  const result = errors(pr).join('\n');
  assert.match(result, /456/);
  assert.match(result, /789/);
});

test('番号なしの過去コミットが範囲に含まれていれば最新が正しくても拒否する', () => {
  const pr = fixture();
  pr.commits.unshift({ oid: 'b'.repeat(40), message: 'fix: 番号なし' });
  assert.match(errors(pr).join('\n'), /コミット/);
});

test('不一致の HEAD と空のコミット集合は成功扱いにしない', () => {
  const pr = fixture();
  pr.headRefOid = 'b'.repeat(40);
  pr.commits = [];
  assert.match(errors(pr).join('\n'), /HEAD/);
  assert.match(errors(pr).join('\n'), /コミット/);
});

test('未記入の実テンプレートは拒否する', () => {
  const pr = fixture();
  pr.body = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.ok(errors(pr).length >= 5);
});

test('コメントやコードブロック内の見出しでは必須節を満たせない', () => {
  const pr = fixture();
  pr.body = `<!-- ${body} -->\n\n\`\`\`markdown\n${body}\n\`\`\``;
  assert.match(errors(pr).join('\n'), /目的・期待する結果/);
});

test('末尾に文字がある偽のコードフェンス終端で見出しを露出させない', () => {
  const pr = fixture();
  pr.body = `\`\`\`markdown\n\`\`\`not-a-closing-fence\n${body}`;
  assert.match(errors(pr).join('\n'), /目的・期待する結果/);
});

test('検証結果のコメントだけ・TODO・箇条書き記号だけを拒否する', () => {
  for (const content of ['<!-- 未記入 -->', 'TODO', '- [ ]', '...']) {
    const pr = fixture();
    pr.body = pr.body.replace('テストを実行して拒否と受理を確認した。', content);
    assert.match(errors(pr).join('\n'), /検証結果/);
  }
});

test('必須節の欠落・重複を拒否する', () => {
  const pr = fixture();
  pr.body = pr.body.replace('## 検証結果', '## 別の節');
  assert.match(errors(pr).join('\n'), /検証結果/);
  pr.body = `${body}\n## 目的・期待する結果\n重複`;
  assert.match(errors(pr).join('\n'), /重複/);
});

test('実際の検証コードとその中の見出し文字列は記載できる', () => {
  const pr = fixture();
  pr.body = pr.body.replace('テストを実行して拒否と受理を確認した。', '```sh\nprintf "## 目的・期待する結果"\n```\n成功した。');
  assert.deepEqual(errors(pr), []);
});

function page(nodes, hasNextPage = false, endCursor = null) {
  return {
    data: { repository: { pullRequest: {
      ...fixture(), updatedAt: '2026-11-13T00:00:00Z',
      closingIssuesReferences: { nodes, pageInfo: { hasNextPage, endCursor } },
    } } },
  };
}

function load(request) {
  return loadPullRequest({ repository, number: 1, expectedHead: head, request });
}

test('リンク情報を最終ページまで取得する', async () => {
  const pages = [page([], true, 'next'), page(fixture().linkedIssues)];
  const pr = await load(async () => pages.shift());
  assert.deepEqual(pr.linkedIssues, fixture().linkedIssues);
});

test('途中の API 失敗や GraphQL の部分エラーで成功にしない', async () => {
  let first = true;
  await assert.rejects(load(async () => {
    if (first) { first = false; return page(fixture().linkedIssues, true, 'next'); }
    throw new Error('API failure');
  }));
  await assert.rejects(load(async () => ({ ...page([]), errors: [{ message: 'partial error' }] })));
});

test('不完全なデータ・循環カーソル・取得中の HEAD 変更を拒否する', async () => {
  await assert.rejects(load(async () => ({ data: { repository: null } })));
  await assert.rejects(load(async () => page([], true, 'same')));
  const pages = [page([], true, 'next'), page([])];
  pages[1].data.repository.pullRequest.headRefOid = 'b'.repeat(40);
  await assert.rejects(load(async () => pages.shift()));
});
