// === 應用配置 ===
const CONFIG = {
    DATA_PATH: 'data/',
    UNITS_INDEX: 'units-index.json',
    DEFAULT_UNIT: 'unit5'
};

// === 全局變量 ===
let appData = null;
let unitsIndex = { units: [] };
let currentUnitId = '';
let starData = {};
let learningStats = {};
let defaultStars = {};

// === 改良的音頻播放器 ===
class StableAudioPlayer {
    constructor() {
        this.currentAudioBtn = null;
        this.currentUtterance = null;
        this.isPlaying = false;
        this.isStopping = false;
        
        this.warmUpTTS();
    }
    
    warmUpTTS() {
        if ('speechSynthesis' in window) {
            try {
                const utterance = new SpeechSynthesisUtterance('');
                utterance.volume = 0;
                speechSynthesis.speak(utterance);
                setTimeout(() => speechSynthesis.cancel(), 100);
                console.log('TTS 引擎預熱成功');
            } catch (e) {
                console.log('TTS 預熱失敗，但仍然可用');
            }
        } else {
            console.warn('瀏覽器不支持 SpeechSynthesis API');
        }
    }
    
    stopCurrentAudio() {
        this.isStopping = true;
        this.isPlaying = false;
        
        if (speechSynthesis && speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        
        this.currentUtterance = null;
        
        if (this.currentAudioBtn) {
            this.currentAudioBtn.classList.remove('playing');
            this.currentAudioBtn.classList.remove('disabled');
            this.currentAudioBtn.disabled = false;
            this.currentAudioBtn = null;
        }
        
        this.isStopping = false;
    }
    
    showAudioStatus(cardElement, message) {
        let statusElement = cardElement.querySelector('.audio-status');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.className = 'audio-status';
            cardElement.appendChild(statusElement);
        }
        
        statusElement.textContent = message;
        statusElement.classList.remove('show');
        void statusElement.offsetWidth;
        statusElement.classList.add('show');
        
        setTimeout(() => {
            statusElement.classList.remove('show');
        }, 2000);
    }
    
    async playAudio(audioKey, btn, event) {
        stopPropagation(event);
        
        if (this.isStopping) {
            return;
        }
        
        if (this.currentAudioBtn === btn && this.isPlaying) {
            this.stopCurrentAudio();
            return;
        }
        
        if (this.isPlaying && this.currentAudioBtn !== btn) {
            this.stopCurrentAudio();
            await this.sleep(100);
        }
        
        const text = this.getTextForAudioKey(audioKey);
        const cardElement = btn.closest('.card-front, .card-back')?.closest('.flashcard');
        
        try {
            await this.playBrowserTTS(text, btn);
            if (cardElement) {
                this.showAudioStatus(cardElement, '使用瀏覽器語音');
            }
        } catch (error) {
            console.error('音頻播放失敗:', error);
            if (cardElement) {
                this.showAudioStatus(cardElement, '語音播放失敗');
            }
            this.resetButtonState(btn);
        }
    }
    
    getTextForAudioKey(audioKey) {
        if (!appData) return audioKey;
        
        const word = appData.words.find(w => w.audio === audioKey);
        if (word) return word.english;
        
        const sentence = appData.sentences.find(s => s.audio === audioKey);
        if (sentence) return sentence.english;
        
        return audioKey;
    }
    
    playBrowserTTS(text, btn) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                reject(new Error('瀏覽器不支持語音合成'));
                return;
            }
            
            if (speechSynthesis.speaking) {
                speechSynthesis.cancel();
                this.sleep(50);
            }
            
            this.currentUtterance = new SpeechSynthesisUtterance(text);
            this.currentUtterance.lang = 'en-GB';
            this.currentUtterance.rate = 0.85;
            this.currentUtterance.volume = 1.0;
            this.currentUtterance.pitch = 1.0;
            this.currentAudioBtn = btn;
            this.isPlaying = true;
            
            btn.classList.add('playing');
            btn.classList.add('disabled');
            btn.disabled = true;
            
            this.currentUtterance.onstart = () => {
                resolve();
            };
            
            this.currentUtterance.onerror = (event) => {
                this.isPlaying = false;
                this.resetButtonState(btn);
                this.currentUtterance = null;
                this.currentAudioBtn = null;
                reject(new Error(`TTS錯誤: ${event.error}`));
            };
            
            this.currentUtterance.onend = () => {
                this.isPlaying = false;
                this.resetButtonState(btn);
                this.currentUtterance = null;
                this.currentAudioBtn = null;
                resolve();
            };
            
            setTimeout(() => {
                try {
                    speechSynthesis.speak(this.currentUtterance);
                } catch (e) {
                    reject(new Error(`TTS播放失敗: ${e.message}`));
                }
            }, 50);
        });
    }
    
    resetButtonState(btn) {
        if (btn) {
            btn.classList.remove('playing');
            btn.classList.remove('disabled');
            btn.disabled = false;
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// === 輔助函數 ===
function stopPropagation(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
}

function formatDate(dateString) {
    if (!dateString) return '從未';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-HK');
}

function formatTime(minutes) {
    if (minutes < 60) {
        return `${minutes} 分鐘`;
    } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours} 小時 ${mins} 分鐘` : `${hours} 小時`;
    }
}

// === 數據管理 ===
const audioPlayer = new StableAudioPlayer();

// 加載單元索引
async function loadUnitsIndex() {
    try {
        const response = await fetch(CONFIG.DATA_PATH + CONFIG.UNITS_INDEX);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        unitsIndex = await response.json();
        return true;
    } catch (error) {
        console.error('加載單元索引失敗:', error);
        unitsIndex = { units: [] };
        return false;
    }
}

// 加載單元數據
async function loadUnitData(unitId) {
    // 先檢查是否是上傳的單元（有 dataUrl）
    const unitInfo = unitsIndex.units.find(u => u.id === unitId);
    if (unitInfo && unitInfo.dataUrl) {
        try {
            const response = await fetch(unitInfo.dataUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            appData = await response.json();
            return true;
        } catch (error) {
            console.error(`加載上傳單元 ${unitId} 失敗:`, error);
            return false;
        }
    }
    
    // 否則從靜態文件加載
    try {
        const response = await fetch(`${CONFIG.DATA_PATH}${unitId}.json`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        appData = await response.json();
        return true;
    } catch (error) {
        console.error(`加載單元 ${unitId} 失敗:`, error);
        return false;
    }
}

// 初始化星星數據
function initStarData() {
    if (!appData) return;
    
    const savedStarData = JSON.parse(localStorage.getItem('starData') || '{}');
    const allIds = [];
    appData.words.forEach(word => allIds.push(word.id));
    appData.sentences.forEach(sentence => allIds.push(sentence.id));
    
    allIds.forEach(id => {
        defaultStars[id] = 0;
        starData[id] = savedStarData[id] || 0;
    });
}

// 初始化學習統計
function initLearningStats() {
    const savedStats = JSON.parse(localStorage.getItem('learningStats') || '{}');
    learningStats = savedStats;
    
    if (!learningStats[currentUnitId]) {
        learningStats[currentUnitId] = {
            totalTime: 0,
            lastAccessed: new Date().toISOString(),
            sessions: 0,
            mastery: 0
        };
    }
}

// 更新學習統計
function updateLearningStats() {
    if (!learningStats[currentUnitId]) {
        learningStats[currentUnitId] = {
            totalTime: 0,
            lastAccessed: new Date().toISOString(),
            sessions: 0,
            mastery: 0
        };
    }
    
    learningStats[currentUnitId].lastAccessed = new Date().toISOString();
    learningStats[currentUnitId].sessions = (learningStats[currentUnitId].sessions || 0) + 1;
    
    saveLearningStats();
}

// 保存學習統計
function saveLearningStats() {
    localStorage.setItem('learningStats', JSON.stringify(learningStats));
    updateDataStatus();
}

// 保存星星數據
function saveStarData() {
    localStorage.setItem('starData', JSON.stringify(starData));
    updateDataStatus();
}

// 更新數據狀態指示器
function updateDataStatus() {
    const status = document.getElementById('data-status');
    status.classList.add('saving');
    
    setTimeout(() => {
        status.classList.remove('saving');
    }, 500);
}

// === 卡片生成 ===
function generateWordCard(word, index) {
    const number = `單詞 ${index + 1}`;
    
    return `
        <div class="card-container">
            <div class="flashcard" onclick="flipCard(this)">
                <div class="card-front">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="stars-container" id="${word.id}-stars"></div>
                        <div class="stars-label" id="${word.id}-label">點擊翻轉卡片</div>
                    </div>
                    <div class="audio-buttons">
                        <button class="audio-btn" onclick="audioPlayer.playAudio('${word.audio}', this, event)">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                </div>
                <div class="card-back">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="answer-text">${word.english}</div>
                        <div class="translation-text">${word.translation}</div>
                        ${word.hint ? `<div class="hint-text">${word.hint}</div>` : ''}
                    </div>
                    <div class="action-buttons">
                        <button class="action-btn correct-btn" onclick="markCorrect('${word.id}', event)" disabled>
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="action-btn review-btn" onclick="markReview('${word.id}', event)" disabled>
                            <i class="fas fa-book"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateSentenceCard(sentence, index) {
    const number = `句子 ${index + 1}`;
    
    return `
        <div class="card-container sentence-card">
            <div class="flashcard" onclick="flipCard(this)">
                <div class="card-front">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="stars-container" id="${sentence.id}-stars"></div>
                        <div class="stars-label" id="${sentence.id}-label">點擊翻轉卡片</div>
                    </div>
                    <div class="audio-buttons">
                        <button class="audio-btn" onclick="audioPlayer.playAudio('${sentence.audio}', this, event)">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                </div>
                <div class="card-back">
                    <div class="card-number">${number}</div>
                    <div class="card-content">
                        <div class="answer-text">${sentence.english}</div>
                        <div class="translation-text">${sentence.translation}</div>
                    </div>
                    <div class="action-buttons">
                        <button class="action-btn correct-btn" onclick="markCorrect('${sentence.id}', event)" disabled>
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="action-btn review-btn" onclick="markReview('${sentence.id}', event)" disabled>
                            <i class="fas fa-book"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function generateCards() {
    const wordsGrid = document.getElementById('words-grid');
    if (wordsGrid && appData.words.length > 0) {
        wordsGrid.innerHTML = appData.words.map((word, index) => 
            generateWordCard(word, index)
        ).join('');
    }
    
    const sentencesGrid = document.getElementById('sentences-grid');
    if (sentencesGrid && appData.sentences.length > 0) {
        sentencesGrid.innerHTML = appData.sentences.map((sentence, index) => 
            generateSentenceCard(sentence, index)
        ).join('');
    }
    
    updateStats();
}

// === 卡片操作 ===
function flipCard(card) {
    card.classList.toggle('flipped');
    
    if (card.classList.contains('flipped')) {
        const cardId = getCardId(card);
        updateButtonsState(cardId);
    } else {
        const cardId = getCardId(card);
        disableButtons(cardId);
    }
}

function getCardId(cardElement) {
    const starsContainer = cardElement.querySelector('.stars-container');
    if (starsContainer && starsContainer.id) {
        return starsContainer.id.replace('-stars', '');
    }
    return null;
}

function updateButtonsState(cardId) {
    if (!cardId) return;
    
    const stars = starData[cardId] || 0;
    const card = document.querySelector(`#${cardId}-stars`)?.closest('.flashcard');
    if (!card) return;
    
    const correctBtn = card.querySelector('.correct-btn');
    const reviewBtn = card.querySelector('.review-btn');
    
    if (correctBtn) {
        correctBtn.disabled = (stars >= 5);
    }
    if (reviewBtn) {
        reviewBtn.disabled = (stars <= 0);
    }
}

function disableButtons(cardId) {
    if (!cardId) return;
    
    const card = document.querySelector(`#${cardId}-stars`)?.closest('.flashcard');
    if (card) {
        const buttons = card.querySelectorAll('.action-btn');
        buttons.forEach(btn => btn.disabled = true);
    }
}

function createStars(cardId, count) {
    const container = document.getElementById(cardId + '-stars');
    if (!container) return;
    
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        const star = document.createElement('div');
        star.className = 'star' + (i < count ? ' active' : '');
        star.innerHTML = '★';
        container.appendChild(star);
    }
    
    const label = document.getElementById(cardId + '-label');
    if (label) {
        if (count === 0) {
            label.textContent = '開始練習';
        } else if (count < 3) {
            label.textContent = '繼續加油呀!';
        } else if (count < 5) {
            label.textContent = '信心大增!';
        } else {
            label.textContent = '真棒! 你已經掌握了';
        }
    }
}

function markCorrect(cardId, event) {
    stopPropagation(event);
    
    if (starData[cardId] < 5) {
        starData[cardId]++;
        saveStarData();
        createStars(cardId, starData[cardId]);
        updateStats();
        updateLearningStats();
        
        const btn = event.target.closest('.correct-btn');
        if (btn) {
            btn.disabled = true;
            btn.style.transform = 'scale(1.1)';
            setTimeout(() => { 
                btn.style.transform = '';
                updateButtonsState(cardId);
            }, 300);
        }
    }
}

function markReview(cardId, event) {
    stopPropagation(event);
    
    if (starData[cardId] > 0) {
        starData[cardId]--;
        saveStarData();
        createStars(cardId, starData[cardId]);
        updateStats();
        updateLearningStats();
        
        const btn = event.target.closest('.review-btn');
        if (btn) {
            btn.disabled = true;
            setTimeout(() => { 
                updateButtonsState(cardId);
            }, 300);
        }
    }
}

// === 統計更新 ===
function updateStats() {
    if (!appData) return;
    
    const wordIds = appData.words.map(word => word.id);
    const sentenceIds = appData.sentences.map(sentence => sentence.id);
    
    // 單詞統計
    const wordStars = wordIds.map(id => starData[id] || 0);
    const totalWords = wordIds.length;
    const masteredWords = wordStars.filter(v => v === 5).length;
    const reviewWords = wordStars.filter(v => v < 5).length;
    const wordsMastery = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;
    
    // 句子統計
    const sentenceStars = sentenceIds.map(id => starData[id] || 0);
    const totalSentences = sentenceIds.length;
    const masteredSentences = sentenceStars.filter(v => v === 5).length;
    const reviewSentences = sentenceStars.filter(v => v < 5).length;
    const sentencesMastery = totalSentences > 0 ? Math.round((masteredSentences / totalSentences) * 100) : 0;
    
    // 更新單詞統計顯示
    document.getElementById('total-words').textContent = totalWords;
    document.getElementById('mastered-words').textContent = masteredWords;
    document.getElementById('review-words').textContent = reviewWords;
    document.getElementById('words-mastery').textContent = `${wordsMastery}%`;
    
    // 更新句子統計顯示
    document.getElementById('total-sentences').textContent = totalSentences;
    document.getElementById('mastered-sentences').textContent = masteredSentences;
    document.getElementById('review-sentences').textContent = reviewSentences;
    document.getElementById('sentences-mastery').textContent = `${sentencesMastery}%`;
    
    // 更新當前單元標題列
    const unitTitleEl = document.getElementById('current-unit-title');
    const unitDescEl = document.getElementById('current-unit-description');
    const unitStatsEl = document.getElementById('current-unit-stats');
    const unitProgressEl = document.getElementById('current-unit-progress');
    const unitHeader = document.getElementById('current-unit-header');
    
    if (appData.unit_title) {
        unitHeader.style.display = 'flex';
        unitTitleEl.textContent = appData.unit_title;
        unitDescEl.textContent = appData.unit_description || '';
        unitStatsEl.textContent = `${totalWords} 詞彙 | ${totalSentences} 句子`;
        
        const totalItems = totalWords + totalSentences;
        const totalMastered = masteredWords + masteredSentences;
        const overallMastery = totalItems > 0 ? Math.round((totalMastered / totalItems) * 100) : 0;
        
        unitProgressEl.textContent = `掌握度: ${overallMastery}%`;
        
        // 更新學習統計中的掌握度
        if (learningStats[currentUnitId]) {
            learningStats[currentUnitId].mastery = overallMastery;
            saveLearningStats();
        }
    } else {
        unitHeader.style.display = 'none';
    }
    
    updateUnitStatsDisplay();
}

// 更新單元詳細統計顯示
function updateUnitStatsDisplay() {
    const statsGrid = document.getElementById('unit-stats-grid');
    const statsList = document.getElementById('unit-stats-list');
    
    if (!statsGrid || !statsList) return;
    
    // 當前單元詳細統計
    const wordIds = appData.words.map(word => word.id);
    const sentenceIds = appData.sentences.map(sentence => sentence.id);
    
    const wordStars = wordIds.map(id => starData[id] || 0);
    const sentenceStars = sentenceIds.map(id => starData[id] || 0);
    
    const totalWords = wordIds.length;
    const masteredWords = wordStars.filter(v => v === 5).length;
    const totalSentences = sentenceIds.length;
    const masteredSentences = sentenceStars.filter(v => v === 5).length;
    
    const totalItems = totalWords + totalSentences;
    const totalMastered = masteredWords + masteredSentences;
    const overallMastery = totalItems > 0 ? Math.round((totalMastered / totalItems) * 100) : 0;
    
    const unitStats = learningStats[currentUnitId] || {};
    
    statsGrid.innerHTML = `
        <div class="unit-stat-item">
            <div class="unit-stat-value">${overallMastery}%</div>
            <div class="unit-stat-label">整體掌握度</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${overallMastery}%"></div>
            </div>
            <div class="unit-stat-desc">${totalMastered}/${totalItems} 個項目</div>
        </div>
        <div class="unit-stat-item">
            <div class="unit-stat-value">${formatTime(unitStats.totalTime || 0)}</div>
            <div class="unit-stat-label">學習時長</div>
            <div class="unit-stat-desc">本單元總學習時間</div>
        </div>
        <div class="unit-stat-item">
            <div class="unit-stat-value">${unitStats.sessions || 0}</div>
            <div class="unit-stat-label">學習次數</div>
            <div class="unit-stat-desc">練習本單元的次數</div>
        </div>
        <div class="unit-stat-item">
            <div class="unit-stat-value">${formatDate(unitStats.lastAccessed)}</div>
            <div class="unit-stat-label">最後學習</div>
            <div class="unit-stat-desc">最近一次練習時間</div>
        </div>
    `;
    
    // 所有單元學習記錄
    let statsListHTML = '';
    for (const unitId in learningStats) {
        const unitStat = learningStats[unitId];
        const unitInfo = unitsIndex.units?.find(u => u.id === unitId) || { title: unitId };
        
        statsListHTML += `
            <div class="unit-stats-item">
                <div class="unit-stats-name">${unitInfo.title || unitId}</div>
                <div class="unit-stats-data">
                    ${formatTime(unitStat.totalTime || 0)} | 
                    掌握度: ${unitStat.mastery || 0}% | 
                    次數: ${unitStat.sessions || 0}
                </div>
            </div>
        `;
    }
    
    statsList.innerHTML = statsListHTML || '<div class="unit-stats-item">暫無學習記錄</div>';
}

// === 分頁管理 ===
function showTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + '-stats').classList.add('active');
    
    document.querySelectorAll('.cards-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(tabName + '-cards').classList.add('active');
}

// === 單元管理 ===
async function loadUnit(unitId) {
    if (!unitId || unitId === currentUnitId) return;
    
    currentUnitId = unitId;
    
    // 顯示加載狀態
    document.getElementById('words-grid').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 載入單元中...</div>';
    document.getElementById('sentences-grid').innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 載入單元中...</div>';
    
    // 加載單元數據
    const success = await loadUnitData(unitId);
    
    if (success) {
        // 初始化數據
        initStarData();
        initLearningStats();
        
        // 生成卡片
        generateCards();
        
        // 初始化頁面
        Object.keys(starData).forEach(key => {
            createStars(key, starData[key]);
        });
        
        Object.keys(starData).forEach(key => {
            disableButtons(key);
        });
        
        // 更新選擇器
        document.getElementById('unit-select').value = unitId;
        
        // 更新學習統計
        updateLearningStats();
        
        // 更新URL參數
        updateUrlParam('unit', unitId);
        
        console.log(`單元 ${unitId} 加載成功`);
    } else {
        document.getElementById('words-grid').innerHTML = '<div class="loading">單元加載失敗，請刷新頁面重試。</div>';
        document.getElementById('sentences-grid').innerHTML = '';
    }
}

// 更新單元選擇器（用於上傳後刷新下拉選單）
function updateUnitSelect() {
    const unitSelect = document.getElementById('unit-select');
    const currentValue = unitSelect.value;
    
    unitSelect.innerHTML = '';
    
    unitsIndex.units.forEach(unit => {
        const option = document.createElement('option');
        option.value = unit.id;
        option.textContent = unit.title;
        unitSelect.appendChild(option);
    });
    
    if (currentValue && unitsIndex.units.find(u => u.id === currentValue)) {
        unitSelect.value = currentValue;
    }
}

// 顯示通知
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// 文件上傳處理
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const unitData = JSON.parse(text);
        
        // 驗證JSON格式
        if (!unitData.unit_id || !unitData.unit_title || !unitData.words || !unitData.sentences) {
            throw new Error('無效的單元JSON格式：缺少 unit_id/unit_title/words/sentences');
        }
        
        // 檢查是否已存在相同ID的單元
        const existingUnitIndex = unitsIndex.units.findIndex(u => u.id === unitData.unit_id);
        
        // 創建臨時單元條目
        const tempUnit = {
            id: unitData.unit_id,
            title: unitData.unit_title,
            description: unitData.unit_description || '自定義上傳單元',
            words_count: unitData.words.length,
            sentences_count: unitData.sentences.length,
            difficulty: unitData.difficulty || 'custom',
            created: new Date().toISOString().split('T')[0],
            dataUrl: URL.createObjectURL(file)  // 存儲Blob URL
        };
        
        if (existingUnitIndex !== -1) {
            // 替換現有單元（同時釋放舊的Blob URL）
            const oldUnit = unitsIndex.units[existingUnitIndex];
            if (oldUnit.dataUrl && oldUnit.dataUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldUnit.dataUrl);
            }
            unitsIndex.units[existingUnitIndex] = tempUnit;
        } else {
            // 添加新單元
            unitsIndex.units.push(tempUnit);
        }
        
        // 更新下拉選單
        updateUnitSelect();
        
        // 加載上傳的單元
        await loadUnit(tempUnit.id);
        
        // 顯示成功消息
        showNotification('單元上傳成功！', 'success');
        
    } catch (error) {
        console.error('上傳失敗:', error);
        showNotification('上傳失敗：' + error.message, 'error');
    } finally {
        event.target.value = ''; // 清空input
    }
}

// === URL參數處理 ===
function updateUrlParam(key, value) {
    const url = new URL(window.location);
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url);
}

function getUrlParam(key) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(key);
}

// === 重置功能 ===
function resetCurrentTabData(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    if (!appData || !confirm('確定要重置當前單元的學習進度嗎？此操作無法撤銷。')) {
        return;
    }
    
    const activeTab = document.querySelector('.tab-btn.active');
    if (!activeTab) return;
    
    const tabText = activeTab.textContent.toLowerCase();
    const isWordsTab = tabText.includes('單詞');
    const isSentencesTab = tabText.includes('句子');
    
    if (isWordsTab) {
        appData.words.forEach(word => {
            starData[word.id] = 0;
        });
    } else if (isSentencesTab) {
        appData.sentences.forEach(sentence => {
            starData[sentence.id] = 0;
        });
    }
    
    saveStarData();
    
    // 重新初始化頁面
    Object.keys(starData).forEach(key => {
        createStars(key, starData[key]);
    });
    
    updateStats();
    
    document.querySelectorAll('.flashcard').forEach(card => {
        card.classList.remove('flipped');
        const cardId = getCardId(card);
        if (cardId) disableButtons(cardId);
    });
    
    alert('當前單元進度已重置！');
}

function resetAllUnitsData(event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    if (!confirm('確定要重置所有單元的學習進度嗎？此操作將清除所有學習記錄，無法撤銷。')) {
        return;
    }
    
    localStorage.removeItem('starData');
    localStorage.removeItem('learningStats');
    
    starData = {};
    learningStats = {};
    
    if (appData) {
        initStarData();
        initLearningStats();
        
        Object.keys(starData).forEach(key => {
            createStars(key, starData[key]);
        });
        
        updateStats();
        
        document.querySelectorAll('.flashcard').forEach(card => {
            card.classList.remove('flipped');
            const cardId = getCardId(card);
            if (cardId) disableButtons(cardId);
        });
    }
    
    alert('所有學習進度已重置！');
}

// === 數據導入導出 ===
function exportData() {
    const exportData = {
        starData: JSON.parse(localStorage.getItem('starData') || '{}'),
        learningStats: JSON.parse(localStorage.getItem('learningStats') || '{}'),
        exportDate: new Date().toISOString(),
        version: '1.0'
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `english-dictation-backup-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    alert('學習數據已導出！');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importData = JSON.parse(e.target.result);
                
                if (confirm('確定要導入學習數據嗎？這將覆蓋現有的學習記錄。')) {
                    if (importData.starData) {
                        localStorage.setItem('starData', JSON.stringify(importData.starData));
                    }
                    if (importData.learningStats) {
                        localStorage.setItem('learningStats', JSON.stringify(importData.learningStats));
                    }
                    
                    // 重新加載當前單元
                    if (currentUnitId) {
                        loadUnit(currentUnitId);
                    }
                    
                    alert('學習數據導入成功！');
                }
            } catch (error) {
                alert('文件格式錯誤，無法導入數據。');
                console.error('導入數據失敗:', error);
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
}

// === 幫助功能 ===
function showHelp() {
    alert(`英語默書練習系統 使用說明：

1. 選擇單元：從下拉選單中選擇要學習的單元
2. 單詞練習：點擊卡片翻轉，查看單詞和翻譯
3. 句子練習：練習完整句子，點擊音頻按鈕聽發音
4. 掌握程度：點擊✓標記掌握，點擊書本標記需複習
5. 星星系統：5顆星表示完全掌握
6. 數據保存：所有進度自動保存在瀏覽器中
7. 重置功能：可重置當前單元或所有單元
8. 數據備份：可導出/導入學習數據
9. 上傳單元：可上載自定義的 JSON 單元檔案

提示：使用耳機或音響可獲得更好的聽力體驗！`);
}

// === 初始化頁面 ===
async function initPage() {
    // 加載單元索引
    const indexLoaded = await loadUnitsIndex();
    
    if (indexLoaded && unitsIndex.units && unitsIndex.units.length > 0) {
        // 填充單元選擇器
        updateUnitSelect();
        
        // 確定要加載的單元
        let unitToLoad = getUrlParam('unit');
        if (!unitToLoad || !unitsIndex.units.find(u => u.id === unitToLoad)) {
            unitToLoad = CONFIG.DEFAULT_UNIT;
        }
        
        // 加載默認單元
        await loadUnit(unitToLoad);
        
        // 設置單元選擇器事件
        document.getElementById('unit-select').addEventListener('change', function() {
            loadUnit(this.value);
        });
        
        // 添加上傳事件
        document.getElementById('unit-upload').addEventListener('change', handleFileUpload);
    } else {
        document.getElementById('words-grid').innerHTML = '<div class="loading">無法載入單元列表，請檢查網絡連接。</div>';
        document.getElementById('sentences-grid').innerHTML = '';
    }
    
    // 設置統計彈窗事件
    document.getElementById('show-unit-stats').addEventListener('click', function() {
        document.getElementById('unit-stats-modal').classList.add('active');
        updateUnitStatsDisplay();
    });
    
    document.getElementById('close-stats').addEventListener('click', function() {
        document.getElementById('unit-stats-modal').classList.remove('active');
    });
    
    document.getElementById('unit-stats-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
        }
    });
    
    // 開始計時學習時間
    setInterval(() => {
        if (learningStats[currentUnitId]) {
            learningStats[currentUnitId].totalTime = (learningStats[currentUnitId].totalTime || 0) + 0.5; // 每30秒加0.5分鐘
            saveLearningStats();
        }
    }, 30000); // 每30秒更新一次
}

// 頁面加載完成時初始化
window.addEventListener('load', initPage);