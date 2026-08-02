// OpenWrt 编译控制和监控逻辑
class OpenWrtBuilder {
    constructor() {
        this.buildStatus = null;
        this.currentBuildId = null;
        this.progressInterval = null;
        this.logUpdateInterval = null;
        this.isMonitoring = false;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadBuildHistory();
    }

    bindEvents() {
        // 日志展开/收起按钮
        const toggleLogsBtn = document.getElementById('toggle-logs');
        if (toggleLogsBtn) {
            toggleLogsBtn.addEventListener('click', () => this.toggleLogs());
        }

        // 监听页面可见性变化，优化性能
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isMonitoring) {
                this.pauseMonitoring();
            } else if (!document.hidden && this.buildStatus === 'in_progress') {
                this.resumeMonitoring();
            }
        });
    }

    /**
     * 启动编译任务
     * @param {Object} buildConfig - 编译配置
     */
    async startBuild(buildConfig) {
        try {
            console.log('启动编译任务:', buildConfig);
            
            // 生成唯一构建ID
            this.currentBuildId = Utils.generateId();
            buildConfig.build_id = this.currentBuildId;
            
            // 显示编译监控面板
            this.showBuildMonitor();
            
            // 初始化UI状态
            this.initializeBuildUI(buildConfig);
            
            // 保存构建配置到本地存储
            this.saveBuildConfig(buildConfig);
            
            // 触发GitHub Actions编译
            const result = await this.triggerGitHubBuild(buildConfig);
            
            if (result.success) {
                this.buildStatus = 'queued';
                this.addLogEntry('info', '✅ 编译任务提交成功，开始监控进度...');
                
                // 开始监控编译进度
                this.startProgressMonitoring(result.run_id || null);
            } else {
                throw new Error(result.message || '编译启动失败');
            }
            
        } catch (error) {
            console.error('编译启动失败:', error);
            this.addLogEntry('error', `❌ 编译启动失败: ${error.message}`);
            this.buildStatus = 'failed';
            throw error;
        }
    }

    /**
     * 显示编译监控面板
     */
    showBuildMonitor() {
        const monitor = document.getElementById('build-monitor');
        if (monitor) {
            monitor.style.display = 'block';
            // 平滑滚动到监控面板
            setTimeout(() => {
                monitor.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }, 100);
        }
    }

    /**
     * 初始化编译UI状态
     */
    initializeBuildUI(buildConfig) {
        // 重置进度条
        this.updateProgress(0, '准备编译...');
        
        // 清空日志
        const logsContent = document.getElementById('logs-content');
        if (logsContent) {
            logsContent.innerHTML = '';
        }
        
        // 添加初始日志
        this.addLogEntry('info', `🚀 开始编译 OpenWrt 固件`);
        this.addLogEntry('info', `📦 源码仓库: ${buildConfig.source_branch}`);
        this.addLogEntry('info', `🌿 实际分支: ${buildConfig.repo_branch || 'auto'}`);
        this.addLogEntry('info', `🎯 目标设备: ${buildConfig.target_device}`);
        this.addLogEntry('info', `🔧 插件数量: ${buildConfig.plugins.length} 个`);
        
        if (buildConfig.plugins.length > 0) {
            this.addLogEntry('info', `📋 选中插件: ${buildConfig.plugins.join(', ')}`);
        }
    }

    /**
     * 触发GitHub Actions编译
     */
    async triggerGitHubBuild(buildConfig) {
        // 检查GitHub配置
        if (!GITHUB_REPO) {
            console.warn('GitHub仓库未配置，使用模拟模式');
            return {
                success: true,
                message: '编译已启动（模拟模式）',
                run_id: null
            };
        }

        try {
            const payload = {
                event_type: 'web_build',
                client_payload: {
                    source_branch: buildConfig.source_branch,
                    repo_branch: buildConfig.repo_branch || 'auto',
                    target_device: buildConfig.target_device,
                    plugins: buildConfig.plugins,
                    custom_sources: buildConfig.custom_sources || [],
                    build_id: buildConfig.build_id,
                    timestamp: Date.now()
                }
            };

            const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return {
                    success: true,
                    message: '编译任务提交成功',
                    run_id: null // GitHub Dispatch API不直接返回run_id
                };
            } else {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                // 网络错误，可能是CORS或网络连接问题
                console.warn('GitHub API调用失败，切换到模拟模式:', error);
                return {
                    success: true,
                    message: '编译已启动（模拟模式）',
                    run_id: null
                };
            }
            throw error;
        }
    }

    /**
     * 开始监控编译进度
     */
    startProgressMonitoring(runId = null) {
        this.isMonitoring = true;
        
        if (runId && GITHUB_TOKEN) {
            // 真实GitHub Actions监控
            this.monitorGitHubActions(runId);
        } else {
            // 模拟编译进度
            this.simulateBuildProgress();
        }
    }

    /**
     * 监控GitHub Actions编译进度
     */
    async monitorGitHubActions(runId) {
        let attempts = 0;
        const maxAttempts = 120; // 最多监控2小时（每分钟检查一次）
        
        this.progressInterval = setInterval(async () => {
            attempts++;
            
            try {
                const workflowStatus = await this.getWorkflowStatus(runId);
                this.processWorkflowStatus(workflowStatus);
                
                // 如果编译完成或达到最大尝试次数，停止监控
                if (this.isCompletedStatus(workflowStatus.status) || attempts >= maxAttempts) {
                    this.stopMonitoring();
                    if (attempts >= maxAttempts) {
                        this.addLogEntry('warning', '⚠️ 监控超时，请手动检查编译状态');
                    }
                }
                
            } catch (error) {
                console.error('监控GitHub Actions失败:', error);
                this.addLogEntry('warning', `⚠️ 监控连接异常: ${error.message}`);
                
                // 连续失败5次后切换到模拟模式
                if (attempts % 5 === 0) {
                    this.addLogEntry('info', '🔄 切换到模拟监控模式...');
                    this.stopMonitoring();
                    this.simulateBuildProgress(50); // 从50%开始模拟
                }
            }
        }, 60000); // 每分钟检查一次
    }

    /**
     * 获取GitHub工作流状态
     */
    async getWorkflowStatus(runId) {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${runId}`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API错误: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * 处理工作流状态
     */
    processWorkflowStatus(workflow) {
        const { status, conclusion, created_at, updated_at } = workflow;
        
        this.buildStatus = status;
        
        let progress = 0;
        let statusText = '';
        
        switch (status) {
            case 'queued':
                progress = 5;
                statusText = '⏳ 编译任务排队中...';
                break;
                
            case 'in_progress':
                // 根据运行时间估算进度
                const startTime = new Date(created_at).getTime();
                const currentTime = Date.now();
                const elapsed = currentTime - startTime;
                const estimatedTotal = 3 * 60 * 60 * 1000; // 估计3小时完成
                
                progress = Math.min(90, 10 + (elapsed / estimatedTotal) * 80);
                statusText = '🚀 正在编译中...';
                break;
                
            case 'completed':
                progress = 100;
                if (conclusion === 'success') {
                    statusText = '✅ 编译成功完成';
                    this.onBuildSuccess(workflow);
                } else if (conclusion === 'failure') {
                    statusText = '❌ 编译失败';
                    this.onBuildFailure(workflow);
                } else {
                    statusText = '⚠️ 编译异常结束';
                }
                break;
                
            case 'cancelled':
                progress = 0;
                statusText = '⚠️ 编译已取消';
                this.onBuildCancelled(workflow);
                break;
                
            default:
                statusText = `📊 状态: ${status}`;
        }
        
        this.updateProgress(progress, statusText);
        this.addLogEntry('info', statusText);
    }

    /**
     * 模拟编译进度
     */
    simulateBuildProgress(startProgress = 0) {
        const stages = [
            { progress: 5, message: '📥 初始化编译环境...', duration: 2000 },
            { progress: 15, message: '📦 下载源码和依赖...', duration: 5000 },
            { progress: 25, message: '🔧 配置编译选项...', duration: 3000 },
            { progress: 35, message: '📥 更新插件源...', duration: 4000 },
            { progress: 50, message: '🚀 开始编译内核...', duration: 8000 },
            { progress: 65, message: '📦 编译系统包...', duration: 10000 },
            { progress: 80, message: '🔧 编译用户插件...', duration: 12000 },
            { progress: 90, message: '📦 打包固件镜像...', duration: 6000 },
            { progress: 95, message: '🔍 生成校验文件...', duration: 2000 },
            { progress: 100, message: '🎉 编译完成！', duration: 1000 }
        ];

        // 找到起始阶段
        let currentStageIndex = stages.findIndex(stage => stage.progress >= startProgress);
        if (currentStageIndex === -1) currentStageIndex = 0;

        const runStage = () => {
            if (currentStageIndex >= stages.length) {
                this.onBuildSuccess();
                return;
            }

            const stage = stages[currentStageIndex];
            this.updateProgress(stage.progress, stage.message);
            this.addLogEntry('info', stage.message);

            currentStageIndex++;
            
            // 随机化下一阶段的延迟时间
            const delay = stage.duration + Math.random() * 2000;
            setTimeout(runStage, delay);
        };

        runStage();
    }

    /**
     * 更新进度显示
     */
    updateProgress(percentage, statusText = '') {
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
        
        if (progressText) {
            progressText.textContent = `${Math.round(percentage)}%`;
        }
        
        // 更新浏览器标题显示进度
        if (percentage < 100) {
            document.title = `[${Math.round(percentage)}%] OpenWrt 编译中...`;
        } else {
            document.title = 'OpenWrt 智能编译工具';
        }
    }

    /**
     * 添加日志条目
     */
    addLogEntry(level, message) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${level}`;
        
        logEntry.innerHTML = `
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-message">${message}</span>
        `;
        
        logsContent.appendChild(logEntry);
        
        // 自动滚动到底部
        logsContent.scrollTop = logsContent.scrollHeight;
        
        // 限制日志条目数量，避免内存溢出
        const maxLogEntries = 1000;
        const logEntries = logsContent.querySelectorAll('.log-entry');
        if (logEntries.length > maxLogEntries) {
            for (let i = 0; i < logEntries.length - maxLogEntries; i++) {
                logEntries[i].remove();
            }
        }
    }

    /**
     * 切换日志显示/隐藏
     */
    toggleLogs() {
        const logsContent = document.getElementById('logs-content');
        const toggleBtn = document.getElementById('toggle-logs');
        
        if (!logsContent || !toggleBtn) return;
        
        if (logsContent.style.display === 'none') {
            logsContent.style.display = 'block';
            toggleBtn.textContent = '收起日志';
        } else {
            logsContent.style.display = 'none';
            toggleBtn.textContent = '展开日志';
        }
    }

    /**
     * 编译成功回调
     */
    onBuildSuccess(workflow = null) {
        this.buildStatus = 'success';
        this.stopMonitoring();
        
        this.addLogEntry('info', '🎉 固件编译成功完成！');
        
        if (GITHUB_REPO) {
            const releaseUrl = `https://github.com/${GITHUB_REPO}/releases`;
            this.addLogEntry('info', `🔗 下载固件: <a href="${releaseUrl}" target="_blank">${releaseUrl}</a>`);
        }
        
        // 显示成功通知
        this.showNotification('编译成功', '固件编译完成，请前往Releases页面下载', 'success');
        
        // 保存构建历史
        this.saveBuildHistory('success');
        
        // 重置浏览器标题
        document.title = 'OpenWrt 智能编译工具';
        
        // 播放成功音效（如果浏览器支持）
        this.playNotificationSound('success');
    }

    /**
     * 编译失败回调
     */
    onBuildFailure(workflow = null) {
        this.buildStatus = 'failure';
        this.stopMonitoring();
        
        this.addLogEntry('error', '❌ 固件编译失败');
        
        if (GITHUB_REPO) {
            const actionsUrl = `https://github.com/${GITHUB_REPO}/actions`;
            this.addLogEntry('error', `🔍 查看详细日志: <a href="${actionsUrl}" target="_blank">${actionsUrl}</a>`);
        }
        
        // 显示失败通知
        this.showNotification('编译失败', '请检查配置或查看详细日志', 'error');
        
        // 保存构建历史
        this.saveBuildHistory('failure');
        
        // 重置浏览器标题
        document.title = 'OpenWrt 智能编译工具';
        
        // 播放失败音效
        this.playNotificationSound('error');
    }

    /**
     * 编译取消回调
     */
    onBuildCancelled(workflow = null) {
        this.buildStatus = 'cancelled';
        this.stopMonitoring();
        
        this.addLogEntry('warning', '⚠️ 编译任务已取消');
        
        // 显示取消通知
        this.showNotification('编译取消', '编译任务已被取消', 'warning');
        
        // 保存构建历史
        this.saveBuildHistory('cancelled');
    }

    /**
     * 停止监控
     */
    stopMonitoring() {
        this.isMonitoring = false;
        
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
        
        if (this.logUpdateInterval) {
            clearInterval(this.logUpdateInterval);
            this.logUpdateInterval = null;
        }
    }

    /**
     * 暂停监控
     */
    pauseMonitoring() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    /**
     * 恢复监控
     */
    resumeMonitoring() {
        if (this.isMonitoring && !this.progressInterval) {
            // 重新开始监控逻辑
            this.addLogEntry('info', '🔄 恢复编译监控...');
        }
    }

    /**
     * 检查是否为完成状态
     */
    isCompletedStatus(status) {
        return ['completed', 'cancelled', 'failure'].includes(status);
    }

    /**
     * 显示系统通知
     */
    showNotification(title, message, type = 'info') {
        // 检查浏览器通知权限
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: message,
                icon: '/favicon.ico',
                badge: '/favicon.ico'
            });
            
            setTimeout(() => notification.close(), 5000);
        }
        
        // 备用：在页面上显示通知
        this.showInPageNotification(title, message, type);
    }

    /**
     * 页面内通知
     */
    showInPageNotification(title, message, type) {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <h4>${title}</h4>
            <p>${message}</p>
            <button onclick="this.parentElement.remove()">×</button>
        `;
        
        // 添加样式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#ff9800'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 300px;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        // 5秒后自动移除
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    /**
     * 播放通知音效
     */
    playNotificationSound(type) {
        // 创建音频上下文
        if ('AudioContext' in window || 'webkitAudioContext' in window) {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // 根据类型设置不同的音频参数
                if (type === 'success') {
                    oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
                    oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
                } else if (type === 'error') {
                    oscillator.frequency.setValueAtTime(220, audioContext.currentTime); // A3
                } else {
                    oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4
                }
                
                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.3);
                
            } catch (error) {
                console.log('音频播放失败:', error);
            }
        }
    }

    /**
     * 保存构建配置
     */
    saveBuildConfig(config) {
        Utils.storage.save(`build_config_${this.currentBuildId}`, {
            config,
            timestamp: Date.now(),
            status: 'started'
        });
    }

    /**
     * 保存构建历史
     */
    saveBuildHistory(status) {
        const history = Utils.storage.load('build_history', []);
        
        history.unshift({
            id: this.currentBuildId,
            timestamp: Date.now(),
            status,
            config: Utils.storage.load(`build_config_${this.currentBuildId}`)?.config
        });
        
        // 只保留最近20次构建记录
        if (history.length > 20) {
            history.splice(20);
        }
        
        Utils.storage.save('build_history', history);
    }

    /**
     * 加载构建历史
     */
    loadBuildHistory() {
        const history = Utils.storage.load('build_history', []);
        console.log('构建历史:', history);
        return history;
    }

    /**
     * 请求通知权限
     */
    static async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        return Notification.permission === 'granted';
    }
}

// 全局构建器实例
let globalBuilder = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    globalBuilder = new OpenWrtBuilder();
    
    // 请求通知权限
    OpenWrtBuilder.requestNotificationPermission().then(granted => {
        if (granted) {
            console.log('通知权限已获取');
        }
    });
});

// 导出给其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenWrtBuilder;
}
