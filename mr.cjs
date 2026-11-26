#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const { select, input } = require('@inquirer/prompts');

/**
 * ===== 样式工具 =====
 */
const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  white: (s) => `\x1b[37m${s}\x1b[0m`,
};

const hr = (char = '─') => console.log(C.dim(char.repeat(52)));
const step = (n, total, text) =>
  console.log(`\n  ${C.magenta(`◉`)} ${C.bold(text)}  ${C.dim(`[${n}/${total}]`)}`);
const info = (label, value) => console.log(`       ${C.dim(label)} ${value}`);
const ok = (text) => console.log(`       ${C.green('✔')} ${text}`);
const warn = (text) => console.log(`       ${C.yellow('⚠')} ${text}`);
const fail = (text) => console.log(`       ${C.red('✖')} ${text}`);

/**
 * spinner: 给异步操作加 loading 动画
 */
function spinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${C.cyan(frames[i++ % frames.length])} ${C.dim(text)}`);
  }, 80);
  return {
    stop: (result) => {
      clearInterval(id);
      process.stdout.write(`\r  ${C.green('✔')} ${text}  ${C.dim('完成')}\n`);
      return result;
    },
    fail: (err) => {
      clearInterval(id);
      process.stdout.write(`\r  ${C.red('✖')} ${text}  ${C.dim('失败')}\n`);
      return err;
    },
  };
}

/**
 * ===== 工具函数 =====
 */
const sh = (cmd, opts = {}) => {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: opts.silent ? 'pipe' : 'inherit',
      ...opts,
    }).trim();
  } catch (e) {
    if (opts.ignoreError) {
      return ((e.stdout || '') + '\n' + (e.stderr || '')).trim();
    }
    console.error(`\n${C.red('✖')} 失败: ${cmd}`);
    if (e.stderr) console.error(e.stderr.toString());
    process.exit(1);
  }
};

/**
 * 从 remote URL 提取项目路径
 */
function getProjectPath() {
  const url = sh('git remote get-url origin', { silent: true, ignoreError: true });
  return url
    .replace(/\.git$/, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\/[^/]+\//, '');
}

/**
 * 通过 glab api 搜索项目成员
 */
function searchProjectMembers(projectPath, query) {
  try {
    const encoded = encodeURIComponent(projectPath);
    const resp = execSync(
      `glab api "/projects/${encoded}/members/all?query=${encodeURIComponent(query)}&per_page=20"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return JSON.parse(resp).map((m) => ({
      id: m.id,
      username: m.username,
      name: m.name,
    }));
  } catch {
    return [];
  }
}

/**
 * 检查是否已存在打开的 MR
 * @returns {string|null} 已存在的 MR URL，或 null
 */
function checkExistingMR(projectPath, sourceBranch, targetBranch) {
  try {
    const encoded = encodeURIComponent(projectPath);
    // 同一源分支可以合并到不同目标分支，必须带上 target_branch 才能准确查重
    const resp = execSync(
      `glab api "/projects/${encoded}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&target_branch=${encodeURIComponent(targetBranch)}&state=opened&per_page=5"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const mrs = JSON.parse(resp);
    if (Array.isArray(mrs) && mrs.length > 0) {
      return {
        url: mrs[0].web_url,
        title: mrs[0].title,
        iid: mrs[0].iid,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ===== 主流程 =====
 */
async function main() {
  const TOTAL_STEPS = 5;

  console.log(`\n  ${C.bold('🚀')}  ${C.bold('创建 Merge Request')}`);
  console.log(`  ${C.dim('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`);
  console.log('');

  const current = sh('git branch --show-current', { silent: true });
  if (!current || current === 'HEAD') {
    console.error(`${C.red('✖')} 无法获取当前分支`);
    process.exit(1);
  }

  info('当前分支', C.cyan(current));

  // ─────────────────────────────────────
  // 推送
  // ─────────────────────────────────────
  const pushSpinner = spinner('推送当前分支到远端...');
  sh(`git push -u origin ${current}`, { silent: true, ignoreError: true });
  pushSpinner.stop();
  console.log('');

  // ─────────────────────────────────────
  // 1/5 选择目标分支
  // ─────────────────────────────────────
  step(1, TOTAL_STEPS, '选择目标分支');

  sh('git fetch --prune', { silent: true, ignoreError: true });

  let target = process.argv[2];
  if (!target) {
    const raw = sh('git branch -r --sort=-committerdate', {
      silent: true,
      ignoreError: true,
    });

    const branches = (raw || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((b) => b && !b.includes('HEAD'))
      .map((b) => b.replace(/^origin\//, ''))
      .filter((b, i, arr) => arr.indexOf(b) === i)
      .slice(0, 20);

    const choices = branches.map((b) => ({ name: b, value: b }));
    choices.push({ name: C.dim('✎ 手动输入...'), value: '__custom__' });

    target = await select({ message: '目标分支:', choices });

    if (target === '__custom__') {
      target = await input({ message: '输入目标分支:', default: 'master' });
    }
  }

  info('目标分支', C.cyan(target));

  // ─────────────────────────────────────
  // 检查是否已存在 MR
  // ─────────────────────────────────────
  const checkSpinner = spinner('检查是否已存在 MR...');
  const projectPath = getProjectPath();
  const existingMR = checkExistingMR(projectPath, current, target);
  checkSpinner.stop();

  if (existingMR) {
    console.log('');
    hr('━');
    console.log(`\n  ${C.yellow('⚠')}  已存在打开的 Merge Request !${C.cyan(existingMR.iid)}`);
    console.log(`       ${C.dim(existingMR.title)}`);
    console.log(`\n  ${C.cyan(existingMR.url)}\n`);
    hr('━');
    console.log('');
    process.exit(0);
  }

  // ─────────────────────────────────────
  // 2/5 MR 标题
  // ─────────────────────────────────────
  step(2, TOTAL_STEPS, '填写 MR 标题');

  const lastCommit = sh('git log -1 --pretty=%s', {
    silent: true,
    ignoreError: true,
  });

  let title = process.argv[3];
  if (!title) {
    title = await input({
      message: 'MR 标题:',
      default: lastCommit,
    });
  }

  // ─────────────────────────────────────
  // 3/5 指定 Assignee
  // ─────────────────────────────────────
  step(3, TOTAL_STEPS, '指定 Assignee');

  let assignee = null;

  const defaultChoices = [];
  defaultChoices.push(
    { name: C.dim('────────────────────'), value: '__sep__', disabled: true },
    { name: `${C.blue('🔍')} 搜索其他成员...`, value: '__search__' },
    { name: C.dim('跳过，不指定'), value: '__skip__' },
  );

  const chosen = await select({
    message: '选择 Assignee:',
    choices: defaultChoices,
  });

  if (chosen === '__search__') {
    let searching = true;
    while (searching) {
      const keyword = await input({ message: '输入姓名或用户名关键字:' });

      if (!keyword.trim()) {
        warn('关键字为空');
        continue;
      }

      const searchSpin = spinner('搜索成员中...');
      const members = searchProjectMembers(projectPath, keyword.trim());
      searchSpin.stop();

      if (members.length === 0) {
        warn('未找到匹配成员');
        const retry = await select({
          message: '操作:',
          choices: [
            { name: '重新搜索', value: true },
            { name: '跳过', value: false },
          ],
        });
        if (!retry) searching = false;
        continue;
      }

      const memberChoices = members.map((m) => ({
        name: `${m.name}  ${C.dim(`@${m.username}`)}`,
        value: m,
      }));
      memberChoices.push({ name: C.dim('↻ 重新搜索'), value: '__retry__' });
      memberChoices.push({ name: C.dim('跳过，不指定'), value: '__skip__' });

      const picked = await select({
        message: `找到 ${members.length} 个成员，选择:`,
        choices: memberChoices,
      });

      if (picked === '__retry__') continue;
      if (picked === '__skip__') {
        searching = false;
        break;
      }
      assignee = picked;
      searching = false;
    }
  } else if (chosen !== '__skip__') {
    assignee = chosen;
  }

  if (assignee) {
    info('Assignee', `${assignee.name} ${C.dim(`@${assignee.username}`)}`);
  }

  // ─────────────────────────────────────
  // 4/5 其他选项
  // ─────────────────────────────────────
  step(4, TOTAL_STEPS, '其他选项');

  const isFeatureBranch = current.startsWith('feature/');

  const removeSource = await select({
    message: '合并后删除源分支?',
    choices: [
      {
        name: !isFeatureBranch
          ? '否（非 feature 分支推荐保留）'
          : '否',
        value: false,
      },
      {
        name: isFeatureBranch
          ? '是（feature 分支推荐删除）'
          : '是',
        value: true,
      },
    ],
  });

  // ─────────────────────────────────────
  // 5/5 确认 & 创建
  // ─────────────────────────────────────
  step(5, TOTAL_STEPS, '确认信息');

  console.log('');
  console.log(`  ${C.dim('┌' + '─'.repeat(48) + '┐')}`);
  console.log(`  ${C.dim('│')} ${C.bold('MR 信息确认')}${' '.repeat(37)}${C.dim('│')}`);
  console.log(`  ${C.dim('├' + '─'.repeat(48) + '┤')}`);
  console.log(`  ${C.dim('│')}  源分支     ${C.cyan(current.padEnd(38))}${C.dim('│')}`);
  console.log(`  ${C.dim('│')}  目标分支   ${C.cyan(target.padEnd(38))}${C.dim('│')}`);
  console.log(`  ${C.dim('│')}  标　题     ${title.length > 34 ? title.slice(0, 31) + '...' : title.padEnd(34)}  ${C.dim('│')}`);
  console.log(
    `  ${C.dim('│')}  Assignee   ${assignee ? `${assignee.name} @${assignee.username}`.padEnd(38) : C.dim('未指定').padEnd(44)}${C.dim('│')}`,
  );
  console.log(
    `  ${C.dim('│')}  删源分支   ${(removeSource ? C.green('是') : C.dim('否')).padEnd(44)}${C.dim('│')}`,
  );
  console.log(`  ${C.dim('└' + '─'.repeat(48) + '┘')}`);
  console.log('');

  const confirm = await select({
    message: '确认创建 MR?',
    choices: [
      { name: C.green('确认创建'), value: true },
      { name: C.red('取消'), value: false },
    ],
  });

  if (!confirm) {
    console.log(`\n  ${C.yellow('⚠')} 已取消\n`);
    process.exit(0);
  }

  // ─────────────────────────────────────
  // 创建 MR
  // ─────────────────────────────────────
  const remoteUrl = sh('git remote get-url origin', { silent: true, ignoreError: true });
  const baseUrl = remoteUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const isGitLab = /gitlab/i.test(baseUrl);

  let prUrl = '';
  let created = false;

  if (isGitLab) {
    const gitlabHost = baseUrl.match(/^https?:\/\/[^/]+/)[0];
    const projPath = remoteUrl
      .replace(/\.git$/, '')
      .replace(/^git@[^:]+:/, '')
      .replace(/^https?:\/\/[^/]+\//, '');

    // 1️⃣ glab CLI
    const hasGlab = (() => {
      try {
        execSync('glab --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (hasGlab) {
      const args = [
        'mr', 'create',
        '-b', target,
        '-s', current,
        '--title', title,
        '--fill', '--yes',
      ];

      if (assignee) args.push('--assignee', assignee.username);
      if (removeSource) args.push('--remove-source-branch');

      const mrSpin = spinner('通过 glab 创建 MR...');
      const r = spawnSync('glab', args, { encoding: 'utf-8' });
      const stdout = (r.stdout || '').trim();
      const stderr = (r.stderr || '').trim();

      if (r.status === 0 && !stdout.includes('ERROR') && !stderr.includes('ERROR')) {
        const match = (stdout + ' ' + stderr).match(/https?:\/\/\S+/);
        prUrl = match ? match[0] : stdout;
        created = true;
        mrSpin.stop();
      } else {
        mrSpin.fail();
        const errMsg = stderr || stdout || '未知错误';

        // 检查是否是已存在 MR 的错误
        if (errMsg.includes('already exists') || errMsg.includes('409')) {
          // 再次查询已有 MR
          const existing = checkExistingMR(projectPath, current, target);
          if (existing) {
            prUrl = existing.url;
          }
        }

        if (!created && !prUrl) {
          // 2️⃣ glab API fallback
          const apiSpin = spinner('尝试 glab API 创建...');
          const encoded = encodeURIComponent(projPath);
          const apiArgs = [
            'api',
            `/projects/${encoded}/merge_requests`,
            '--method', 'POST',
            '-f', `source_branch=${current}`,
            '-f', `target_branch=${target}`,
            '-f', `title=${title}`,
            '-f', `remove_source_branch=${removeSource}`,
          ];
          if (assignee) apiArgs.push('--field', `assignee_ids[]=${assignee.id}`);

          try {
            const apiResp = spawnSync('glab', apiArgs, { encoding: 'utf-8' });
            const apiOutput = (apiResp.stdout || '') + (apiResp.stderr || '');

            if (apiResp.status === 0) {
              const data = JSON.parse(apiResp.stdout);
              if (data.web_url) {
                prUrl = data.web_url;
                created = true;
                apiSpin.stop();
              }
            }

            if (!created) {
              apiSpin.fail();
            }
          } catch {
            apiSpin.fail();
          }
        }

        // 3️⃣ curl API fallback
        if (!created && !prUrl) {
          const token = process.env.GITLAB_TOKEN || process.env.GITLAB_PRIVATE_TOKEN || '';

          if (token) {
            const curlSpin = spinner('尝试 curl API 创建...');
            const apiUrl = `${gitlabHost}/api/v4/projects/${encodeURIComponent(projPath)}/merge_requests`;
            const curl = `curl -s -X POST "${apiUrl}" \
-H "PRIVATE-TOKEN: ${token}" \
-H "Content-Type: application/json" \
-d '${JSON.stringify({ source_branch: current, target_branch: target, title, remove_source_branch: removeSource, ...(assignee ? { assignee_ids: [assignee.id] } : {}) })}'`;

            try {
              const resp = sh(curl, { silent: true });
              const data = JSON.parse(resp);
              if (data.web_url) {
                prUrl = data.web_url;
                created = true;
                curlSpin.stop();
              } else {
                curlSpin.fail();
              }
            } catch {
              curlSpin.fail();
            }
          }
        }
      }
    }

    // 4️⃣ fallback web URL
    if (!created && !prUrl) {
      const params = new URLSearchParams({
        'merge_request[source_branch]': current,
        'merge_request[target_branch]': target,
        'merge_request[title]': title,
        'merge_request[remove_source_branch]': removeSource ? '1' : '0',
      });
      prUrl = `${baseUrl}/-/merge_requests/new?${params.toString()}`;
    }
  } else {
    // GitHub
    const hasGh = (() => {
      try {
        execSync('gh --version', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (hasGh) {
      const ghSpin = spinner('通过 gh 创建 PR...');
      prUrl = sh(
        `gh pr create --base "${target}" --head "${current}" --title "${title}" --fill`,
        { silent: true },
      );
      created = true;
      ghSpin.stop();
    } else {
      prUrl = `${baseUrl}/compare/${target}...${current}`;
    }
  }

  // ─────────────────────────────────────
  // 结果
  // ─────────────────────────────────────
  console.log('');
  hr('━');

  if (created) {
    console.log(`\n  ${C.green('🎉')}  ${C.bold(C.green('MR 创建成功！'))}`);
    console.log(`\n  ${C.cyan(prUrl.trim())}\n`);

    const switchBranch = await select({
      message: '是否立即切换到目标分支?',
      choices: [
        { name: `否，留在 ${C.cyan(current)}`, value: false },
        { name: `是，切换到 ${C.cyan(target)}`, value: true },
      ],
    });

    if (switchBranch) {
      const switchSpin = spinner(`切换到 ${target}...`);
      sh(`git checkout ${target}`, { silent: true, ignoreError: true });
      switchSpin.stop();
      ok(`已切换到 ${C.cyan(target)}`);
    }
  } else {
    console.log(`\n  ${C.yellow('⚠')}  自动创建失败，已打开手动创建页面`);
    console.log(`\n  ${C.cyan(prUrl.trim())}\n`);

    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      execSync(`${openCmd} "${prUrl}"`, { stdio: 'pipe' });
      ok('已在浏览器中打开创建页面');
    } catch {
      // 忽略打开失败
    }
  }

  console.log('');
  hr('━');
  console.log('');
}

main();
