/**
 * GitHub Actions 编译阶段监控。
 *
 * 进度只根据工作流中已经完成的步骤计算，不根据耗时猜测，也不会在固定
 * 时长后停止。浏览器刷新后会从 localStorage 恢复当前运行。
 */
class BuildMonitor {
    constructor() {
        this.storageKey = 'openwrt_active_build';
        this.workflowFile = 'smart-build.yml';
        this.pollIntervalMs = 30000;
        this.hiddenPollIntervalMs = 60000;
        this.findIntervalMs = 8000;
        this.maxRetryDelayMs = 300000;

        this.active = false;
        this.runId = null;
        this.runUrl = null;
        this.repoUrl = null;
        this.buildId = null;
        this.dispatchedAt = null;
        this.runStartedAt = null;
        this.token = null;
        this.pollTimer = null;
        this.elapsedTimer = null;
        this.consecutiveErrors = 0;
        this.waitingWasLogged = false;
        this.lastCurrentStageKey = null;
        this.loggedCompletedStages = new Set();

        this.stageDefinitions = [
            { job: '配置解析', step: '检出代码', label: '准备配置解析' },
            { job: '配置解析', step: '解析编译配置', label: '解析编译配置' },
            { job: '固件编译', step: '检出代码', label: '准备编译任务' },
            { job: '固件编译', step: '初始化编译环境', label: '初始化编译环境' },
            { job: '固件编译', step: '克隆源码', label: '克隆源码' },
            { job: '固件编译', step: '加载自定义feeds', label: '加载自定义 Feeds' },
            { job: '固件编译', step: '更新feeds', label: '更新 Feeds' },
            { job: '固件编译', step: '修复 OpenWrt', label: '应用兼容性修复' },
            { job: '固件编译', step: '安装feeds', label: '安装 Feeds' },
            { job: '固件编译', step: '生成最终编译配置', label: '生成最终编译配置' },
            { job: '固件编译', step: '下载依赖包', label: '下载依赖包' },
            { job: '固件编译', step: '编译固件', label: '编译固件' },
            { job: '固件编译', step: '检查空间使用', label: '检查空间使用' },
            { job: '固件编译', step: '整理编译产物', label: '整理编译产物' },
            { job: '固件编译', step: '生成发布版本', label: '生成发布版本' },
            { job: '固件编译', step: '发布固件到 Releases', label: '发布固件到 Releases' },
            { job: '固件编译', step: '编译完成通知', label: '完成编译任务' }
        ];

        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('visibilitychange', () => {
            if (this.active && this.runId) {
                this.schedulePoll(1000);
            }
        });

        window.addEventListener('online', () => {
            if (!this.active) return;
            this.log('info', '🌐 网络连接已恢复，继续获取编译状态');
            this.consecutiveErrors = 0;
            this.runId ? this.schedulePoll(1000) : this.scheduleFind(1000);
        });
    }

    hasActiveBuild() {
        return Boolean(this.loadState());
    }

    start({ token, repoUrl, buildId, dispatchedAt }) {
        this.stop({ clearState: false });

        this.active = true;
        this.token = token;
        this.repoUrl = repoUrl;
        this.buildId = buildId;
        this.dispatchedAt = dispatchedAt || Date.now();
        this.runStartedAt = this.dispatchedAt;
        this.runId = null;
        this.runUrl = null;
        this.consecutiveErrors = 0;
        this.waitingWasLogged = false;
        this.lastCurrentStageKey = null;
        this.loggedCompletedStages.clear();

        this.saveState();
        this.prepareUi();
        this.setProgressResult(null);
        this.updateProgress(0, '阶段 0/' + (this.stageDefinitions.length + 1), '等待 GitHub 创建任务', true);
        this.startElapsedClock();
        this.log('info', `🔎 正在查找本次编译任务（${buildId}）`);
        this.findRun();
    }

    resume({ token, repoUrl }) {
        const state = this.loadState();
        if (!state || !token) return false;

        this.stop({ clearState: false });
        this.active = true;
        this.token = token;
        this.repoUrl = state.repoUrl || repoUrl;
        this.buildId = state.buildId;
        this.dispatchedAt = state.dispatchedAt;
        this.runStartedAt = state.runStartedAt || state.dispatchedAt;
        this.runId = state.runId || null;
        this.runUrl = state.runUrl || null;
        this.consecutiveErrors = 0;
        this.waitingWasLogged = false;
        this.lastCurrentStageKey = null;
        this.loggedCompletedStages.clear();

        this.prepareUi();
        this.setProgressResult(null);
        this.startElapsedClock();
        this.log('info', `🔄 已恢复编译任务监控（${this.buildId}）`);

        if (this.runId) {
            this.pollRun();
        } else {
            this.findRun();
        }
        return true;
    }

    updateToken(token) {
        if (!token) return;
        this.token = token;
        this.consecutiveErrors = 0;

        if (this.active) {
            this.runId ? this.schedulePoll(1000) : this.scheduleFind(1000);
        }
    }

    async findRun() {
        if (!this.active || this.runId) return;

        try {
            const endpoint = `https://api.github.com/repos/${this.repoUrl}/actions/workflows/${this.workflowFile}/runs?event=repository_dispatch&per_page=20`;
            const data = await this.fetchJson(endpoint);
            const exactRun = (data.workflow_runs || []).find(run =>
                String(run.display_title || '').includes(this.buildId)
            );

            if (!exactRun) {
                if (!this.waitingWasLogged) {
                    this.log('info', '⏳ GitHub 正在创建工作流任务，页面会自动继续查找');
                    this.waitingWasLogged = true;
                }
                this.updateProgress(0, '阶段 0/' + (this.stageDefinitions.length + 1), '等待任务进入队列', true);
                this.scheduleFind(this.findIntervalMs);
                return;
            }

            this.runId = exactRun.id;
            this.runUrl = exactRun.html_url;
            this.runStartedAt = new Date(exactRun.created_at).getTime();
            this.consecutiveErrors = 0;
            this.saveState();
            this.updateActionsLink();
            this.log('success', `🎯 已连接到编译任务 #${exactRun.run_number}`);
            this.pollRun();
        } catch (error) {
            this.handleApiError(error, '查找编译任务');
            this.scheduleFind(this.getRetryDelay());
        }
    }

    async pollRun() {
        if (!this.active || !this.runId) return;

        try {
            const runEndpoint = `https://api.github.com/repos/${this.repoUrl}/actions/runs/${this.runId}`;
            const jobsEndpoint = `${runEndpoint}/jobs?filter=latest&per_page=100`;
            const [runData, jobsData] = await Promise.all([
                this.fetchJson(runEndpoint),
                this.fetchJson(jobsEndpoint)
            ]);

            if (this.consecutiveErrors > 0) {
                this.log('success', '✅ 已恢复与 GitHub 的状态同步');
            }
            this.consecutiveErrors = 0;
            this.runUrl = runData.html_url || this.runUrl;
            this.runStartedAt = new Date(runData.run_started_at || runData.created_at).getTime();
            this.saveState();
            this.updateActionsLink();
            this.renderRun(runData, jobsData.jobs || []);

            if (runData.status === 'completed') {
                this.finish(runData);
                return;
            }

            const interval = document.hidden ? this.hiddenPollIntervalMs : this.pollIntervalMs;
            this.schedulePoll(interval);
        } catch (error) {
            this.handleApiError(error, '获取编译状态');
            this.schedulePoll(this.getRetryDelay());
        }
    }

    renderRun(runData, jobs) {
        const stages = this.getStageStates(jobs);
        const finalStageCount = this.stageDefinitions.length + 1;
        const completedCount = stages.filter(stage => stage.status === 'completed').length;
        const failedIndex = stages.findIndex(stage =>
            stage.status === 'completed' && ['failure', 'cancelled', 'timed_out'].includes(stage.conclusion)
        );
        let currentIndex = failedIndex >= 0
            ? failedIndex
            : stages.findIndex(stage => stage.status === 'in_progress');

        if (currentIndex < 0) {
            currentIndex = stages.findIndex(stage => stage.status !== 'completed');
        }

        let currentLabel;
        if (runData.status === 'queued') {
            currentLabel = '等待 GitHub Runner';
            currentIndex = 0;
        } else if (currentIndex >= 0) {
            currentLabel = stages[currentIndex].label;
        } else {
            currentIndex = this.stageDefinitions.length;
            currentLabel = '完成工作流收尾';
        }

        const isCompleted = runData.status === 'completed';
        const isSuccess = isCompleted && runData.conclusion === 'success';
        const progress = isSuccess
            ? 100
            : Math.min(95, Math.round((completedCount / finalStageCount) * 100));
        const displayPosition = isCompleted && isSuccess
            ? finalStageCount
            : Math.min(currentIndex + 1, finalStageCount);
        const progressLabel = isCompleted
            ? (isSuccess ? `阶段 ${finalStageCount}/${finalStageCount}` : `结束于阶段 ${displayPosition}/${finalStageCount}`)
            : `阶段 ${displayPosition}/${finalStageCount}`;

        this.updateProgress(progress, progressLabel, currentLabel, !isCompleted);
        this.setProgressResult(runData.conclusion);
        this.logStageChanges(stages, currentIndex, currentLabel, runData);
        document.title = isCompleted
            ? 'OpenWrt 智能编译工具'
            : `${currentLabel} · OpenWrt 编译`;
    }

    getStageStates(jobs) {
        return this.stageDefinitions.map(definition => {
            const job = jobs.find(item => String(item.name || '').includes(definition.job));
            const step = job?.steps?.find(item => String(item.name || '').includes(definition.step));

            return {
                ...definition,
                status: step?.status || 'pending',
                conclusion: step?.conclusion || null,
                startedAt: step?.started_at || null,
                completedAt: step?.completed_at || null
            };
        });
    }

    logStageChanges(stages, currentIndex, currentLabel, runData) {
        stages.forEach((stage, index) => {
            if (stage.status !== 'completed' || this.loggedCompletedStages.has(index)) return;

            this.loggedCompletedStages.add(index);
            if (stage.conclusion === 'success') {
                this.log('success', `✅ 已完成：${stage.label}`);
            } else if (stage.conclusion === 'skipped') {
                this.log('info', `⏭️ 已跳过：${stage.label}`);
            } else if (stage.conclusion) {
                this.log('error', `❌ ${stage.label}：${this.getConclusionText(stage.conclusion)}`);
            }
        });

        const currentStage = currentIndex >= 0 ? stages[currentIndex] : null;
        const currentKey = `${runData.status}:${runData.conclusion || ''}:${currentIndex}:${currentStage?.status || ''}`;
        if (currentKey === this.lastCurrentStageKey) return;

        this.lastCurrentStageKey = currentKey;
        if (runData.status === 'queued') {
            this.log('info', '⏳ 编译任务正在等待 Runner');
        } else if (runData.status !== 'completed') {
            this.log('info', `▶️ 当前阶段：${currentLabel}`);
        }
    }

    finish(runData) {
        const duration = this.formatDuration(Date.now() - this.runStartedAt);
        const conclusion = runData.conclusion;

        if (conclusion === 'success') {
            this.log('success', `🎉 固件编译成功，总耗时 ${duration}`);
            this.log('info', `📦 固件下载：https://github.com/${this.repoUrl}/releases`);
            this.notify('编译成功', '固件已经发布，请前往 Releases 下载', 'success');
        } else if (conclusion === 'cancelled') {
            this.log('warning', `⚠️ 编译任务已取消，运行时间 ${duration}`);
            this.notify('编译已取消', 'GitHub Actions 编译任务已取消', 'warning');
        } else {
            this.log('error', `❌ 编译${this.getConclusionText(conclusion)}，运行时间 ${duration}`);
            this.log('info', `🔗 请打开本次 GitHub Actions 任务查看失败原因：${this.runUrl}`);
            this.notify('编译失败', '请打开本次 GitHub Actions 任务查看失败原因', 'error');
        }

        this.active = false;
        this.clearTimers();
        this.clearState();
        document.title = 'OpenWrt 智能编译工具';
    }

    stopByUser() {
        if (!this.active) {
            this.log('info', 'ℹ️ 当前没有正在监控的任务');
            return;
        }

        this.stop({ clearState: true });
        this.updateStageText('已停止监控');
        this.log('warning', '🛑 已停止网页监控，GitHub 上的编译任务不会被取消');
        document.title = 'OpenWrt 智能编译工具';
    }

    stop({ clearState = false } = {}) {
        this.active = false;
        this.clearTimers();
        if (clearState) this.clearState();
    }

    clearTimers() {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        if (this.elapsedTimer) clearInterval(this.elapsedTimer);
        this.pollTimer = null;
        this.elapsedTimer = null;
    }

    scheduleFind(delay) {
        if (!this.active) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => this.findRun(), delay);
    }

    schedulePoll(delay) {
        if (!this.active || !this.runId) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(() => this.pollRun(), delay);
    }

    startElapsedClock() {
        if (this.elapsedTimer) clearInterval(this.elapsedTimer);
        const update = () => {
            if (!this.active) return;
            const timeElement = document.getElementById('progress-time');
            if (timeElement) {
                timeElement.textContent = `已运行 ${this.formatDuration(Date.now() - this.runStartedAt)}`;
            }
        };
        update();
        this.elapsedTimer = setInterval(update, 1000);
    }

    updateProgress(progress, progressLabel, stageLabel, isActive) {
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-text');
        const stage = document.getElementById('progress-stage');

        if (bar) {
            bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
            bar.classList.toggle('is-active', Boolean(isActive));
            bar.setAttribute('aria-valuenow', String(progress));
        }
        if (text) text.textContent = progressLabel;
        if (stage) stage.textContent = stageLabel;
    }

    updateStageText(stageLabel) {
        const stage = document.getElementById('progress-stage');
        if (stage) stage.textContent = stageLabel;
    }

    setProgressResult(conclusion) {
        const bar = document.getElementById('progress-bar');
        if (!bar) return;
        bar.classList.toggle('is-success', conclusion === 'success');
        bar.classList.toggle('is-failed', Boolean(conclusion && conclusion !== 'success'));
    }

    prepareUi() {
        const monitor = document.getElementById('build-monitor');
        if (monitor) monitor.style.display = 'block';
        this.updateActionsLink();
    }

    updateActionsLink() {
        const link = document.getElementById('view-actions-btn');
        if (!link) return;
        link.href = this.runUrl || `https://github.com/${this.repoUrl}/actions`;
    }

    async fetchJson(url) {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || `GitHub API 返回 ${response.status}`);
        }
        return response.json();
    }

    handleApiError(error, action) {
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors === 1) {
            this.log('warning', `⚠️ ${action}暂时失败：${error.message}，将自动重试`);
        }
        this.updateStageText('连接暂时中断，正在自动重试');
    }

    getRetryDelay() {
        return Math.min(
            this.maxRetryDelayMs,
            this.pollIntervalMs * Math.pow(2, Math.min(this.consecutiveErrors - 1, 4))
        );
    }

    saveState() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({
                repoUrl: this.repoUrl,
                buildId: this.buildId,
                dispatchedAt: this.dispatchedAt,
                runStartedAt: this.runStartedAt,
                runId: this.runId,
                runUrl: this.runUrl
            }));
        } catch (error) {
            console.warn('保存编译监控状态失败:', error);
        }
    }

    loadState() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return null;
            const state = JSON.parse(raw);
            return state?.buildId ? state : null;
        } catch (error) {
            console.warn('读取编译监控状态失败:', error);
            return null;
        }
    }

    clearState() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.warn('清除编译监控状态失败:', error);
        }
    }

    log(type, message) {
        if (window.wizardManager?.addLogEntry) {
            window.wizardManager.addLogEntry(type, message);
        } else {
            console.log(message);
        }
    }

    notify(title, message, type) {
        window.wizardManager?.showNotification?.(title, message, type);
    }

    formatDuration(milliseconds) {
        const safeMilliseconds = Math.max(0, Number(milliseconds) || 0);
        const totalMinutes = Math.floor(safeMilliseconds / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours > 0) return `${hours}小时${minutes}分钟`;
        if (totalMinutes > 0) return `${totalMinutes}分钟`;
        return `${Math.floor(safeMilliseconds / 1000)}秒`;
    }

    getConclusionText(conclusion) {
        const labels = {
            failure: '失败',
            cancelled: '已取消',
            timed_out: '超时',
            action_required: '需要处理',
            stale: '已过期',
            skipped: '已跳过'
        };
        return labels[conclusion] || '异常结束';
    }
}

window.buildMonitor = new BuildMonitor();
window.BuildMonitor = BuildMonitor;
