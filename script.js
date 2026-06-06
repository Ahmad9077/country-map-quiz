const QUESTION_COUNT = 15;
const MAP_WIDTH = 960;
const MAP_HEIGHT = 610;

const elements = {
  quizPanel: document.querySelector("#quiz-panel"),
  resultsPanel: document.querySelector("#results-panel"),
  questionLabel: document.querySelector("#question-label"),
  scoreValue: document.querySelector("#score-value"),
  progressBar: document.querySelector("#progress-bar"),
  mapStage: document.querySelector("#map-stage"),
  neighborCount: document.querySelector("#neighbor-count"),
  zoomToggle: document.querySelector("#zoom-toggle"),
  options: document.querySelector("#options"),
  feedback: document.querySelector("#feedback"),
  nextButton: document.querySelector("#next-button"),
  restartButton: document.querySelector("#restart-button"),
  playAgainButton: document.querySelector("#play-again-button"),
  resultTitle: document.querySelector("#result-title"),
  resultMessage: document.querySelector("#result-message"),
  finalScore: document.querySelector("#final-score"),
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

init();

async function init() {
  try {
    const response = await fetch("assets/maps/countries-50m.json?v=7");
    topology = await response.json();
    geometries = topology.objects.countries.geometries;
    adjacency = topojson.neighbors(geometries);
    countries = buildCountryDataset();
    quizCountries = countries.filter(isQuizEligibleCountry);
    startQuiz();
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = "Could not load the local map dataset. Please refresh the page.";
    elements.quizPanel.replaceChildren(message);
    console.error(error);
  }
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
  quiz = shuffle([...quizCountries]).slice(0, QUESTION_COUNT).map(country => ({
    country,
    options: buildOptions(country)
  }));
  currentIndex = 0;
  score = 0;
  locked = false;
  answers = [];
  elements.resultsPanel.hidden = true;
  elements.quizPanel.hidden = false;
  renderQuestion();
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
    if (selected.size >= 4) break;
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
  locked = false;
  zoomedOut = false;

  elements.questionLabel.textContent = `Question ${currentIndex + 1} of ${QUESTION_COUNT}`;
  elements.scoreValue.textContent = score;
  elements.progressBar.style.width = `${((currentIndex + 1) / QUESTION_COUNT) * 100}%`;
  elements.neighborCount.textContent = getBorderLabel(item.country.neighbors.length);
  elements.feedback.hidden = true;
  elements.feedback.replaceChildren();
  elements.nextButton.disabled = true;
  elements.nextButton.textContent = "Choose an answer";
  elements.options.replaceChildren();

  updateZoomToggle();
  renderMap(item.country);

  item.options.forEach((option, index) => {
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
    elements.options.append(button);
  });
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

function chooseAnswer(selectedId) {
  if (locked) return;
  locked = true;

  const item = quiz[currentIndex];
  const selectedCountry = countries.find(country => country.id === selectedId);
  const isCorrect = selectedId === item.country.id;
  if (isCorrect) score += 1;

  answers.push({
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
  elements.nextButton.textContent = currentIndex === QUESTION_COUNT - 1 ? "Show Results" : "Next Question";
  elements.progressBar.style.width = `${((currentIndex + 1) / QUESTION_COUNT) * 100}%`;
}

function nextQuestion() {
  if (!locked) return;
  if (currentIndex === QUESTION_COUNT - 1) {
    showResults();
    return;
  }
  currentIndex += 1;
  renderQuestion();
}

function showResults() {
  const percent = Math.round((score / QUESTION_COUNT) * 100);
  locked = false;
  elements.quizPanel.hidden = true;
  elements.resultsPanel.hidden = false;
  elements.resultTitle.textContent = `${score} out of ${QUESTION_COUNT}`;
  elements.finalScore.textContent = score;
  elements.finalPercent.textContent = `${percent}%`;
  elements.resultGauge.style.setProperty("--score-angle", `${percent * 3.6}deg`);
  elements.scoreGrade.textContent = getScoreGrade(percent);
  elements.resultMessage.textContent = getPerformanceMessage(percent);
  elements.reviewList.replaceChildren();

  answers.forEach((answer, index) => {
    elements.reviewList.append(createReviewItem(answer, index));
  });

  window.QuizzesHubProgress?.record({
    quizId: "country-map",
    score,
    total: QUESTION_COUNT,
    level: getScoreGrade(percent),
    details: {
      percent,
      answers: answers.map(answer => ({
        prompt: answer.country.name,
        expected: answer.country.name,
        selected: answer.selected.name,
        correct: answer.correct
      }))
    }
  });
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
elements.restartButton.addEventListener("click", startQuiz);
elements.playAgainButton.addEventListener("click", startQuiz);
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
