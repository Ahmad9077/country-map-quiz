const MAP_WIDTH = 960;
const MAP_HEIGHT = 610;
const difficultySettings = {
  easy: { label: "Easy", questionCount: 10, optionCount: 3 },
  medium: { label: "Medium", questionCount: 15, optionCount: 4 },
  hard: { label: "Hard", questionCount: 20, optionCount: 4 }
};

const QUIZ_ID = "country-map";
const SESSION_STORAGE_KEY = `${QUIZ_ID}:active-session:v1`;
const ADAPTIVE_READY_TIMEOUT_MS = 3000;
const isChallengeMode = Boolean(new URLSearchParams(window.location.search).get("challenge_session"));

const elements = {
  quizPanel: document.querySelector("#quiz-panel"),
  resultsPanel: document.querySelector("#results-panel"),
  questionLabel: document.querySelector("#question-label"),
  scoreValue: document.querySelector("#score-value"),
  scoreTotalValue: document.querySelector("#score-total-value"),
  progressBar: document.querySelector("#progress-bar"),
  mapStage: document.querySelector("#map-stage"),
  neighborCount: document.querySelector("#neighbor-count"),
  zoomToggle: document.querySelector("#zoom-toggle"),
  options: document.querySelector("#options"),
  feedback: document.querySelector("#feedback"),
  nextButton: document.querySelector("#next-button"),
  playAgainButton: document.querySelector("#play-again-button"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  finalScore: document.querySelector("#final-score"),
  finalTotal: document.querySelector("#final-total"),
  finalPercent: document.querySelector("#final-percent"),
  resultGauge: document.querySelector("#result-gauge"),
  scoreGrade: document.querySelector("#score-grade"),
  reviewList: document.querySelector("#review-list")
};

const excludedNames = new Set([
  "Antarctica",
  "Fr. S. Antarctic Lands",
  "N. Cyprus",
  "Somaliland",
  "W. Sahara"
]);

const normalizedNames = new Map([
  ["Bosnia and Herz.", "Bosnia and Herzegovina"],
  ["Central African Rep.", "Central African Republic"],
  ["Congo", "Republic of the Congo"],
  ["Czechia", "Czech Republic"],
  ["Dem. Rep. Congo", "Democratic Republic of the Congo"],
  ["Dominican Rep.", "Dominican Republic"],
  ["Eq. Guinea", "Equatorial Guinea"],
  ["eSwatini", "Eswatini"],
  ["Lao PDR", "Laos"],
  ["North Macedonia", "North Macedonia"],
  ["Palestine", "Palestine"],
  ["S. Sudan", "South Sudan"],
  ["Solomon Is.", "Solomon Islands"],
  ["Timor-Leste", "East Timor"],
  ["United States of America", "United States"]
]);

const specialFacts = new Map([
  ["Russia", "Russia shares land borders with more countries than any other country in the quiz."],
  ["China", "China has one of the world's longest land borders and many neighboring countries."],
  ["Brazil", "Brazil touches nearly every country in mainland South America."],
  ["France", "Mainland France borders countries from the North Sea region to the Mediterranean."],
  ["India", "India's outline is framed by the Himalayas, deserts, plains, and long coastlines."],
  ["Kuwait", "Kuwait sits at the northwestern edge of the Persian Gulf."],
  ["United States", "The contiguous United States borders Canada to the north and Mexico to the south."]
]);

const largeIslandCountries = new Set([
  "Australia",
  "Cuba",
  "Iceland",
  "Ireland",
  "Japan",
  "Madagascar",
  "New Zealand",
  "Philippines",
  "Sri Lanka",
  "Taiwan",
  "United Kingdom"
]);

const blockedQuizCountryNames = new Set([
  "Israel"
]);

let topology;
let geometries = [];
let countries = [];
let quizCountries = [];
let adjacency = [];
let quiz = [];
let currentIndex = 0;
let score = 0;
let locked = false;
let answers = [];
let zoomedOut = false;
let quizSettings = difficultySettings.medium;
let assignmentDifficulty = "medium";
let challengeState = null;
let challengeQuestion = null;
let challengeAnswer = null;

const accessReady = window.QuizzesHubAccessReady || Promise.reject(new Error("Missing Quizzes Hub access guard."));
accessReady.then((access) => {
  assignmentDifficulty = normalizeDifficulty(access?.difficulty);
  quizSettings = isChallengeMode ? difficultySettings.medium : difficultySettings[assignmentDifficulty];
  init();
}).catch(showAccessMessage);

async function init() {
  try {
    const response = await fetch("assets/maps/countries-50m.json?v=7");
    topology = await response.json();
    geometries = topology.objects.countries.geometries;
    adjacency = topojson.neighbors(geometries);
    countries = buildCountryDataset();
    quizCountries = countries.filter(isQuizEligibleCountry);
    if (isChallengeMode) {
      await initChallengeMode();
      return;
    }
    await waitForAdaptiveReady();
    startQuiz();
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = "Could not load the local map dataset. Please refresh the page.";
    elements.quizPanel.replaceChildren(message);
    console.error(error);
  }
}

async function initChallengeMode() {
  try {
    challengeState = await window.QuizzesHubChallengeReady;
    window.QuizzesHubChallenge.onChange((state) => {
      challengeState = state;
      challengeAnswer = null;
      renderChallengeQuestion();
    });
    renderChallengeQuestion();
  } catch (error) {
    console.error(error);
    elements.quizPanel.innerHTML = "<p>Could not open this challenge. Please return to Quizzes Hub.</p>";
  }
}

function showAccessMessage() {
  document.documentElement.dataset.quizAccess = "denied";
  elements.quizPanel.innerHTML = "<p>Please open this quiz from Quizzes Hub.</p>";
}

function buildCountryDataset() {
  const featureCollection = topojson.feature(topology, topology.objects.countries);

  return geometries
    .map((geometry, index) => {
      const feature = featureCollection.features[index];
      const rawName = geometry.properties.name;
      const name = normalizedNames.get(rawName) || rawName;
      const neighbors = adjacency[index].filter(neighborIndex => {
        const neighborName = geometries[neighborIndex].properties.name;
        return !excludedNames.has(neighborName);
      });
      const centroid = d3.geoCentroid(feature);

      return {
        id: geometry.id,
        index,
        rawName,
        name,
        feature,
        neighbors,
        centroid,
        bounds: d3.geoBounds(feature),
        fact: getCountryFact(name, neighbors.length)
      };
    })
    .filter(country => !excludedNames.has(country.rawName))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getCountryFact(name, borderCount) {
  if (specialFacts.has(name)) return specialFacts.get(name);
  if (borderCount === 0) return `${name} has no land neighbors in this map dataset.`;
  if (borderCount === 1) return `${name} has 1 land neighbor in this map dataset.`;
  return `${name} has ${borderCount} land neighbors in this map dataset.`;
}

function isQuizEligibleCountry(country) {
  if (blockedQuizCountryNames.has(country.name)) return false;
  return country.neighbors.length > 0 || largeIslandCountries.has(country.name);
}

function startQuiz() {
  if (restoreSession()) return;

  quiz = selectQuestionCountries().map(country => ({
    key: country.name,
    country,
    options: buildOptions(country)
  }));
  currentIndex = 0;
  score = 0;
  locked = false;
  answers = [];
  elements.resultsPanel.hidden = true;
  elements.quizPanel.hidden = false;
  saveSession();
  renderQuestion();
}

function startNewQuiz() {
  if (isChallengeMode) {
    window.QuizzesHubChallenge?.openHub?.();
    return;
  }
  clearSession();
  startQuiz();
}

function renderChallengeQuestion() {
  if (!challengeState) return;

  elements.resultsPanel.hidden = true;
  elements.quizPanel.hidden = false;

  if (challengeState.status === "finished") {
    renderChallengeFinished();
    return;
  }

  if (challengeState.status !== "active") {
    elements.questionLabel.textContent = "Challenge Mode";
    elements.scoreValue.textContent = getMyWrongCount();
    elements.scoreTotalValue.textContent = "/ 3 wrong";
    elements.progressBar.style.width = "0%";
    elements.neighborCount.textContent = "";
    elements.mapStage.replaceChildren();
    elements.options.replaceChildren();
    elements.feedback.hidden = false;
    elements.feedback.textContent = "Waiting for the challenge to start.";
    elements.nextButton.disabled = false;
    elements.nextButton.textContent = "Back to Hub";
    return;
  }

  const questionCountry = findQuizCountry(challengeState.current_question_key);
  if (!questionCountry) {
    renderChallengeMissingQuestion();
    return;
  }

  challengeQuestion = {
    key: questionCountry.name,
    country: questionCountry,
    options: buildOptions(questionCountry)
  };

  renderQuestion();
}

function selectQuestionCountries() {
  const allQuestions = quizCountries.map(country => ({ key: country.name, country }));
  const adaptiveQuestions = window.QuizzesHubAdaptive?.selectQuestions?.(allQuestions, quizSettings.questionCount);
  if (Array.isArray(adaptiveQuestions) && adaptiveQuestions.length > 0) {
    return adaptiveQuestions.map(question => question.country).filter(Boolean);
  }
  return shuffle([...quizCountries]).slice(0, quizSettings.questionCount);
}

function buildOptions(correct) {
  const selected = new Map([[correct.id, correct]]);
  const ranked = quizCountries
    .filter(country => country.id !== correct.id)
    .map(country => ({
      country,
      score: distractorScore(correct, country) + Math.random() * 0.25
    }))
    .sort((a, b) => b.score - a.score);

  for (const item of ranked) {
    if (selected.size >= quizSettings.optionCount) break;
    selected.set(item.country.id, item.country);
  }

  return shuffle([...selected.values()]);
}

function distractorScore(correct, candidate) {
  const isNeighbor = correct.neighbors.includes(candidate.index);
  const distance = d3.geoDistance(correct.centroid, candidate.centroid);
  const proximityScore = Math.max(0, 14 - distance * 8);
  const nameScore = sharedWords(correct.name, candidate.name) * 1.5;
  const borderScore = Math.max(0, 3 - Math.abs(correct.neighbors.length - candidate.neighbors.length) * 0.35);
  return proximityScore + nameScore + borderScore + (isNeighbor ? 9 : 0);
}

function renderQuestion() {
  const item = quiz[currentIndex];
  const activeItem = isChallengeMode ? challengeQuestion : item;
  if (!activeItem) return;

  const savedAnswer = isChallengeMode ? challengeAnswer : answers[currentIndex];
  locked = Boolean(savedAnswer);
  const canAnswer = !isChallengeMode || window.QuizzesHubChallenge?.canAnswer?.();
  zoomedOut = false;

  elements.questionLabel.textContent = isChallengeMode
    ? `Challenge question ${challengeState.current_turn_index + 1}`
    : `Question ${currentIndex + 1} of ${quizSettings.questionCount}`;
  elements.scoreValue.textContent = isChallengeMode ? getMyWrongCount() : score;
  elements.scoreTotalValue.textContent = isChallengeMode ? "/ 3 wrong" : `/ ${quizSettings.questionCount}`;
  elements.progressBar.style.width = isChallengeMode
    ? `${Math.min(getMyWrongCount(), 3) / 3 * 100}%`
    : `${((currentIndex + (savedAnswer ? 1 : 0)) / quizSettings.questionCount) * 100}%`;
  elements.neighborCount.textContent = getBorderLabel(activeItem.country.neighbors.length);
  elements.feedback.hidden = true;
  elements.feedback.replaceChildren();
  elements.nextButton.disabled = isChallengeMode ? false : !savedAnswer;
  elements.nextButton.textContent = isChallengeMode
    ? "Back to Hub"
    : savedAnswer
    ? currentIndex === quizSettings.questionCount - 1 ? "Show Results" : "Next Question"
    : "Choose an answer";
  elements.options.replaceChildren();

  updateZoomToggle();
  renderMap(activeItem.country);

  activeItem.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.dataset.id = option.id;
    button.dataset.key = String(index + 1);
    const label = document.createElement("span");
    label.className = "option-text";
    label.textContent = option.name;
    button.append(label);
    button.setAttribute("aria-label", `Option ${index + 1}: ${option.name}`);
    button.addEventListener("click", () => chooseAnswer(option.id));
    button.disabled = isChallengeMode && !canAnswer;

    if (savedAnswer) {
      const buttonId = String(option.id);
      const isCorrectButton = buttonId === String(activeItem.country.id);
      const isChosenWrong = buttonId === String(savedAnswer.selected.id) && !savedAnswer.correct;
      button.disabled = true;
      if (isCorrectButton) button.classList.add("correct");
      if (isChosenWrong) button.classList.add("wrong");
      if (buttonId === String(savedAnswer.selected.id)) button.setAttribute("aria-pressed", "true");
    }

    elements.options.append(button);
  });

  if (savedAnswer) {
    elements.feedback.hidden = false;
    renderFeedback(savedAnswer.correct, activeItem.country);
    removeAnswerMedia();
  } else if (isChallengeMode) {
    renderChallengeStatus();
  }
}

function renderMap(country) {
  elements.mapStage.replaceChildren();

  const viewBounds = getExpandedBounds(country, zoomedOut ? getManualZoomMultiplier(country) : 1);
  const contextCountries = countries.filter(item => (
    item.id !== country.id && boundsIntersect(item.bounds, viewBounds)
  ));
  const projection = createProjection(viewBounds);
  const path = d3.geoPath(projection);

  const svg = d3.select(elements.mapStage)
    .append("svg")
    .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
    .attr("aria-hidden", "true");

  svg.append("path")
    .datum(d3.geoGraticule10())
    .attr("class", "map-graticule")
    .attr("d", path);

  svg.selectAll(".map-context")
    .data(contextCountries)
    .join("path")
    .attr("class", item => (
      country.neighbors.includes(item.index) ? "map-context map-neighbor" : "map-context"
    ))
    .attr("d", item => path(item.feature));

  svg.append("path")
    .datum(country.feature)
    .attr("class", "map-target")
    .attr("d", path);

  svg.append("path")
    .datum(topojson.mesh(topology, topology.objects.countries, (a, b) => a !== b))
    .attr("class", "map-boundary")
    .attr("d", path);
}

function getBorderLabel(count) {
  if (count === 0) return "No land borders";
  if (count === 1) return "1 land border";
  return `${count} land borders`;
}

function getExpandedBounds(country, zoomMultiplier = 1) {
  const [[west, south], [east, north]] = country.bounds;
  const centerLon = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const lonSpan = Math.max(0.7, east - west);
  const latSpan = Math.max(0.7, north - south);
  const largestSpan = Math.max(lonSpan, latSpan);
  const zoomOut = getZoomOutFactor(largestSpan) * zoomMultiplier;
  const minHalfSpan = largestSpan < 4 ? 3.2 : 1.8;
  const lonHalf = Math.max((lonSpan * zoomOut) / 2, minHalfSpan);
  const latHalf = Math.max((latSpan * zoomOut) / 2, minHalfSpan);

  return [
    [clamp(centerLon - lonHalf, -179.8, 179.8), clamp(centerLat - latHalf, -84, 84)],
    [clamp(centerLon + lonHalf, -179.8, 179.8), clamp(centerLat + latHalf, -84, 84)]
  ];
}

function toggleMapZoom() {
  if (!quiz[currentIndex]) return;
  zoomedOut = !zoomedOut;
  updateZoomToggle();
  renderMap(quiz[currentIndex].country);
}

function getManualZoomMultiplier(country) {
  const [[west, south], [east, north]] = country.bounds;
  const largestSpan = Math.max(east - west, north - south);
  if (largestSpan < 1.5) return 6.5;
  if (largestSpan < 4) return 4.8;
  if (largestSpan < 10) return 3.4;
  if (largestSpan < 22) return 2.5;
  return 1.9;
}

function updateZoomToggle() {
  elements.zoomToggle.textContent = zoomedOut ? "Zoom in" : "Zoom out";
  elements.zoomToggle.setAttribute("aria-pressed", String(zoomedOut));
}

function getZoomOutFactor(span) {
  if (span < 1.5) return 5;
  if (span < 4) return 3.2;
  if (span < 10) return 2.3;
  if (span < 22) return 1.8;
  if (span < 48) return 1.45;
  return 1.25;
}

function createProjection([[west, south], [east, north]]) {
  const paddingX = 58;
  const paddingY = 46;
  const center = [(west + east) / 2, (south + north) / 2];
  const projection = d3.geoMercator()
    .center(center)
    .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2])
    .scale(1);

  const corners = [
    projection([west, south]),
    projection([east, south]),
    projection([east, north]),
    projection([west, north])
  ];
  const xValues = corners.map(point => point[0]);
  const yValues = corners.map(point => point[1]);
  const projectedWidth = Math.max(...xValues) - Math.min(...xValues);
  const projectedHeight = Math.max(...yValues) - Math.min(...yValues);
  const scale = Math.min(
    (MAP_WIDTH - paddingX * 2) / projectedWidth,
    (MAP_HEIGHT - paddingY * 2) / projectedHeight
  );

  return projection.scale(scale);
}

function boundsIntersect([[westA, southA], [eastA, northA]], [[westB, southB], [eastB, northB]]) {
  return eastA >= westB && eastB >= westA && northA >= southB && northB >= southA;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function chooseAnswer(selectedId) {
  if (locked) return;
  locked = true;

  const item = isChallengeMode ? challengeQuestion : quiz[currentIndex];
  if (!item) return;

  const selectedCountry = countries.find(country => country.id === selectedId);
  const isCorrect = selectedId === item.country.id;
  if (isChallengeMode) {
    challengeAnswer = {
      questionKey: item.key,
      country: item.country,
      selected: selectedCountry,
      correct: isCorrect
    };
    renderQuestion();
    const result = await window.QuizzesHubChallenge.submitAnswer({
      answerText: selectedCountry?.name || String(selectedId),
      isCorrect
    });
    if (!result.ok) {
      locked = false;
      elements.feedback.hidden = false;
      elements.feedback.textContent = result.reason || "Could not submit answer.";
    }
    return;
  }

  if (isCorrect) score += 1;

  answers.push({
    questionKey: item.key,
    country: item.country,
    selected: selectedCountry,
    correct: isCorrect
  });

  [...elements.options.children].forEach(button => {
    const buttonId = String(button.dataset.id);
    const isCorrectButton = buttonId === String(item.country.id);
    const isChosenWrong = buttonId === String(selectedId) && !isCorrect;
    button.disabled = true;
    if (isCorrectButton) button.classList.add("correct");
    if (isChosenWrong) button.classList.add("wrong");
    if (buttonId === String(selectedId)) button.setAttribute("aria-pressed", "true");
  });

  elements.scoreValue.textContent = score;
  elements.feedback.hidden = false;
  renderFeedback(isCorrect, item.country);
  removeAnswerMedia();
  elements.nextButton.disabled = false;
  elements.nextButton.textContent = currentIndex === quizSettings.questionCount - 1 ? "Show Results" : "Next Question";
  elements.progressBar.style.width = `${((currentIndex + 1) / quizSettings.questionCount) * 100}%`;
  saveSession();
}

function nextQuestion() {
  if (isChallengeMode) {
    window.QuizzesHubChallenge?.openHub?.();
    return;
  }
  if (!locked) return;
  if (currentIndex === quizSettings.questionCount - 1) {
    showResults();
    return;
  }
  currentIndex += 1;
  saveSession();
  renderQuestion();
}

function showResults() {
  const percent = Math.round((score / quizSettings.questionCount) * 100);
  clearSession();
  locked = false;
  elements.quizPanel.hidden = true;
  elements.resultsPanel.hidden = false;
  elements.resultTitle.textContent = `${score} out of ${quizSettings.questionCount}`;
  elements.finalScore.textContent = score;
  elements.finalTotal.textContent = quizSettings.questionCount;
  elements.finalPercent.textContent = `${percent}%`;
  elements.resultGauge.style.setProperty("--score-angle", `${percent * 3.6}deg`);
  elements.scoreGrade.textContent = getScoreGrade(percent);
  elements.resultMessage.textContent = getPerformanceMessage(percent);
  elements.reviewList.replaceChildren();

  answers.forEach((answer, index) => {
    elements.reviewList.append(createReviewItem(answer, index));
  });

  void recordCompletedQuiz(percent);
}

function normalizeDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(difficultySettings, value) ? value : "medium";
}

async function recordCompletedQuiz(percent) {
  if (isChallengeMode) return;
  await waitForAdaptiveReady();

  let adaptiveRecorded = false;
  if (window.QuizzesHubAdaptive?.recordAttempt) {
    try {
      const result = await window.QuizzesHubAdaptive.recordAttempt(
        answers.map(answer => ({
          question: { key: answer.questionKey || answer.country.name },
          correct: answer.correct
        }))
      );
      adaptiveRecorded = Boolean(result?.ok);
    } catch (error) {
      console.warn("Adaptive recording failed", error);
    }
  }

  if (adaptiveRecorded) return;

  await window.QuizzesHubProgress?.record({
    quizId: QUIZ_ID,
    score,
    total: quizSettings.questionCount,
    level: getScoreGrade(percent),
    details: {
      difficulty: assignmentDifficulty,
      percent,
      answers: answers.map(answer => ({
        key: answer.questionKey || answer.country.name,
        prompt: answer.country.name,
        expected: answer.country.name,
        selected: answer.selected.name,
        correct: answer.correct
      }))
    }
  });
}

function waitForAdaptiveReady() {
  if (isChallengeMode) return Promise.resolve(null);
  if (!window.QuizzesHubAdaptiveReady) return Promise.resolve(null);
  return Promise.race([
    window.QuizzesHubAdaptiveReady.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), ADAPTIVE_READY_TIMEOUT_MS))
  ]);
}

function renderChallengeStatus() {
  elements.feedback.hidden = false;
  elements.feedback.replaceChildren();

  const lastTurn = challengeState?.last_turn;
  if (lastTurn) {
    const lastPlayer = (challengeState.players || []).find(player => player.user_id === lastTurn.answering_player_id);
    const result = document.createElement("strong");
    result.textContent = lastTurn.is_correct ? "Correct." : "Wrong.";
    elements.feedback.append(lastPlayer?.display_name || "Player", " answered: ", result);
  } else {
    elements.feedback.textContent = "Challenge is live.";
  }

  if (!window.QuizzesHubChallenge?.canAnswer?.()) {
    const currentPlayer = (challengeState.players || []).find(player => player.user_id === challengeState.current_answering_user_id);
    elements.feedback.append(" Waiting for ", currentPlayer?.display_name || "the other player", ".");
  }
}

function renderChallengeFinished() {
  const winner = (challengeState.players || []).find(player => player.user_id === challengeState.winner_id);
  elements.questionLabel.textContent = "Challenge complete";
  elements.scoreValue.textContent = getMyWrongCount();
  elements.scoreTotalValue.textContent = "/ 3 wrong";
  elements.progressBar.style.width = "100%";
  elements.neighborCount.textContent = "";
  elements.mapStage.replaceChildren();
  elements.options.replaceChildren();
  elements.feedback.hidden = false;
  elements.feedback.textContent = winner ? `${winner.display_name} wins.` : "Challenge finished.";
  elements.nextButton.disabled = false;
  elements.nextButton.textContent = "Back to Hub";
}

function renderChallengeMissingQuestion() {
  elements.questionLabel.textContent = "Challenge Mode";
  elements.scoreValue.textContent = getMyWrongCount();
  elements.scoreTotalValue.textContent = "/ 3 wrong";
  elements.progressBar.style.width = "0%";
  elements.neighborCount.textContent = "";
  elements.mapStage.replaceChildren();
  elements.options.replaceChildren();
  elements.feedback.hidden = false;
  elements.feedback.textContent = "This challenge question is not available in this quiz version.";
  elements.nextButton.disabled = false;
  elements.nextButton.textContent = "Back to Hub";
}

function getMyWrongCount() {
  const me = (challengeState?.players || []).find(player => player.user_id === window.QuizzesHubChallenge?.currentUserId);
  return me?.wrong_count || 0;
}

function restoreSession() {
  const session = loadSession();
  if (!session || session.assignmentDifficulty !== assignmentDifficulty) return false;
  if (!Array.isArray(session.quiz) || session.quiz.length === 0) return false;

  quiz = restoreQuiz(session.quiz);
  if (quiz.length === 0) {
    clearSession();
    return false;
  }
  currentIndex = clampNumber(session.currentIndex, 0, quiz.length - 1);
  score = clampNumber(session.score, 0, quiz.length);
  answers = restoreAnswers(session.answers);
  locked = Boolean(answers[currentIndex]);

  elements.resultsPanel.hidden = true;
  elements.quizPanel.hidden = false;
  renderQuestion();
  return true;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      assignmentDifficulty,
      quiz: quiz.map(item => ({
        key: item.key,
        optionKeys: item.options.map(option => option.name)
      })),
      currentIndex,
      score,
      answers: answers.map(answer => ({
        questionKey: answer.questionKey || answer.country.name,
        selectedKey: answer.selected.name,
        correct: answer.correct
      }))
    }));
  } catch {
    // Storage can be unavailable in private browsing; the quiz still works.
  }
}

function restoreQuiz(savedQuiz) {
  return savedQuiz.map(saved => {
    const country = findQuizCountry(saved.key);
    if (!country || !Array.isArray(saved.optionKeys)) return null;
    const options = saved.optionKeys.map(findQuizCountry).filter(Boolean);
    return options.length > 0 ? { key: country.name, country, options } : null;
  }).filter(Boolean);
}

function restoreAnswers(savedAnswers) {
  if (!Array.isArray(savedAnswers)) return [];
  return savedAnswers.map(saved => {
    const country = findQuizCountry(saved.questionKey);
    const selected = findQuizCountry(saved.selectedKey);
    if (!country || !selected) return null;
    return {
      questionKey: country.name,
      country,
      selected,
      correct: Boolean(saved.correct)
    };
  }).filter(Boolean);
}

function findQuizCountry(name) {
  return quizCountries.find(country => country.name === name);
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function renderFeedback(isCorrect, country) {
  elements.feedback.replaceChildren();

  const status = document.createElement("strong");
  status.textContent = isCorrect ? "Correct." : "Wrong.";
  elements.feedback.append(status, " ");

  if (!isCorrect) {
    const countryName = document.createElement("strong");
    countryName.textContent = country.name;
    elements.feedback.append("The correct answer is ", countryName, ". ");
  }

  elements.feedback.append(country.fact);
}

function removeAnswerMedia() {
  elements.options.querySelectorAll("img, picture, video").forEach(element => element.remove());
  elements.feedback.querySelectorAll("img, picture, video").forEach(element => element.remove());
}

function createReviewItem(answer, index) {
  const row = document.createElement("article");
  row.className = "review-item";

  const mark = document.createElement("div");
  mark.className = `review-mark ${answer.correct ? "good" : "bad"}`;
  mark.textContent = answer.correct ? "Correct" : "Wrong";

  const country = document.createElement("strong");
  country.textContent = `${index + 1}. ${answer.country.name}`;

  const selected = document.createElement("span");
  selected.textContent = `Your answer: ${answer.selected.name}`;

  row.append(mark, country, selected);
  return row;
}

function getScoreGrade(percent) {
  if (percent === 100) return "A+";
  if (percent >= 80) return "A";
  if (percent >= 60) return "B";
  if (percent >= 40) return "C";
  return "Practice";
}

function getPerformanceMessage(percent) {
  if (percent === 100) return "Perfect round. You read every outline and border cue.";
  if (percent >= 80) return "Excellent score. Only a few regional shapes slowed you down.";
  if (percent >= 60) return "Solid result. Replaying will make the neighboring borders easier to recognize.";
  if (percent >= 40) return "Good start. Use the review list to compare the countries you mixed up.";
  return "Tough round. Focus on coastline shape, border count, and nearby-country outlines.";
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sharedWords(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 3));
  return b.toLowerCase().split(/[^a-z]+/).filter(word => wordsA.has(word)).length;
}

elements.nextButton.addEventListener("click", nextQuestion);
elements.playAgainButton.addEventListener("click", startNewQuiz);
elements.zoomToggle.addEventListener("click", toggleMapZoom);

document.addEventListener("keydown", event => {
  if (!elements.resultsPanel.hidden) return;

  if (event.key >= "1" && event.key <= "4" && !locked) {
    const button = elements.options.children[Number(event.key) - 1];
    if (button) button.click();
  }
  if ((event.key === "Enter" || event.key === " ") && locked && !elements.nextButton.disabled) {
    elements.nextButton.click();
  }
});
