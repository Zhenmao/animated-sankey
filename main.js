////////////////////////////////////////////////////////////
//// Process Data //////////////////////////////////////////
////////////////////////////////////////////////////////////
d3.csv("table_7.csv", d3.autoType).then((csv) => {
  let data = {
    stackedProbabilities: {}, // Stacked probabilities has category-start as the key, and an array of accumulated probabilities as the value.
    categories: [],
    starts: [],
    ends: [],
    startTitle: "Parents' educational attainment",
    endTitle: "Children's educational attainment",
  };
  const genders = {
    Girls: "F",
    Boys: "M",
    Children: "P",
  };
  const races = {
    White: "White",
    Black: "Black",
    Hispanic: "Hispanic",
    Asian: "Asian",
    "Native American": "AIAN",
  };
  const educations = {
    "Less than high school": "1",
    "High school": "2",
    "Some college/associate degree": "3",
    "Bachelor degree or higher": "4",
  };
  const categories = d3.cross(Object.keys(races), Object.keys(genders));
  categories.forEach(([race, gender]) => {
    const d = csv.find(
      (d) => d.kid_race == races[race] && d.gender == genders[gender]
    );
    Object.keys(educations).forEach((eStart) => {
      const key = getStackedProbabilitiesKey({
        category: `${race} ${gender}`,
        start: eStart,
      });
      let total = 0;
      const stacked = Object.keys(educations).reduce(
        (stacked, eEnd, i, arr) => {
          if (i == arr.length - 1) {
            stacked.push(1); // Account for stacked probability rounding error
          } else {
            total +=
              d[`kid_edu${educations[eEnd]}_cond_par_edu${educations[eStart]}`];
            stacked.push(total);
          }
          return stacked;
        },
        []
      );
      data.stackedProbabilities[key] = stacked;
    });
  });

  data.categories = categories.map(([race, gender]) => `${race} ${gender}`);
  data.starts = Object.keys(educations).reverse();
  data.ends = Object.keys(educations).reverse();

  const sankey = animatedSankey({
    container: d3.select(".chart-wrapper"),
    data,
  });

  const dispatch = d3.dispatch("change");
  dispatch.on("change", sankey.simulate);

  initCategoryControls({
    categories: data.categories,
    dispatch,
  });
});
////////////////////////////////////////////////////////////
//// Controls //////////////////////////////////////////////
////////////////////////////////////////////////////////////
function initCategoryControls({ categories, dispatch }) {
  const selects = d3
    .selectAll(".category-select")
    .data(d3.range(2))
    .on("change", toggleSelect);
  const options = selects
    .selectAll("option")
    .data(categories)
    .join("option")
    .attr("value", (d) => d)
    .each(function (d, j) {
      const i = d3.select(this.parentNode).datum();
      d3.select(this)
        .attr(
          "selected",
          (i == 0 && j == 0) || (i == 1 && j == 1) ? "selected" : null
        )
        .attr(
          "disabled",
          (i == 0 && j == 1) || (i == 1 && j == 0) ? "disabled" : null
        );
    })
    .text((d) => d);

  dispatch.call("change", {}, categories.slice(0, 2));

  function toggleSelect() {
    const selected = selects.nodes().map((node) => node.value);
    dispatch.call("change", {}, selected);

    options.each(function (d) {
      const i = d3.select(this.parentNode).datum();
      d3.select(this).attr(
        "disabled",
        (i == 0 && d == selected[1]) || (i == 1 && d == selected[0])
          ? "disabled"
          : null
      );
    });
  }
}

////////////////////////////////////////////////////////////
//// Animated Sankey ///////////////////////////////////////
////////////////////////////////////////////////////////////
function animatedSankey({
  container,
  data: {
    stackedProbabilities,
    categories,
    starts,
    ends,
    startTitle,
    endTitle,
  },
}) {
  // Dimension
  let width;
  const itemSize = 12;
  const pathWidth = 80;
  const pathInnerWidth = pathWidth - itemSize - 4;
  const pathPadding = 48;
  const margin = { top: 30, right: 210, bottom: 20, left: 20 };
  const height =
    Math.max(starts.length, ends.length) * (pathWidth + pathPadding) -
    pathPadding +
    margin.top +
    margin.bottom;
  const endBarWidth = 20;
  const dpr = window.devicePixelRatio || 1;

  // Style
  const categoryColors = ["rgba(236, 89, 3, 0.9)", "rgb(57, 188, 179, 0.9)"];
  const emptyBarColor = "rgba(221, 221, 221, 0.9)";
  const pathColor = "rgba(221, 221, 221, 0.6)";

  const formatCount = d3.format(",");
  const formatPercentage = d3.format(".0%");

  // Container
  const canvas = container.append("canvas").attr("height", height * dpr);
  const context = canvas.node().getContext("2d");
  const svg = container.append("svg").attr("height", height);

  // Accessors
  const categoryIndexAccessor = (d) => d.categoryIndex;
  const startAccessor = (d) => d.start;
  const endAccessor = (d) => d.end;

  // Scales
  const xScale = d3.scaleLinear().domain([0, 1]);
  const yStartScale = d3
    .scalePoint()
    .domain(starts)
    .range([
      margin.top + pathWidth / 2,
      height - margin.bottom - pathWidth / 2,
    ]);
  const yEndScale = d3
    .scalePoint()
    .domain(ends)
    .range([
      margin.top + pathWidth / 2,
      height - margin.bottom - pathWidth / 2,
    ]);
  const yProgressScale = d3
    .scaleLinear()
    .domain([0.42, 0.58])
    .range([0, 1])
    .clamp(true);

  // Path generator
  const pathData = d3.cross(starts, ends).map((d) => new Array(6).fill(d));
  const pathGenerator = d3
    .line()
    .y((d, i) => (i <= 2 ? yStartScale(d[0]) : yEndScale(d[1])))
    .curve(d3.curveMonotoneX)
    .context(context);

  updateDimension();

  function updateDimension() {
    width = container.node().clientWidth;
    canvas.attr("width", width * dpr);
    context.scale(dpr, dpr);
    svg.attr("width", width);
    xScale.range([margin.left, width - margin.right]);
    pathGenerator.x(
      (d, i) =>
        xScale.range()[0] + (i * (xScale.range()[1] - xScale.range()[0])) / 5
    );
  }

  window.addEventListener("resize", updateDimension);

  // Simulation data
  const itemCountMax = 10000;
  const itemCountIncrement = 2;
  const itemFlowDuration = 5000;
  let items;
  let selectedCategories;
  let timer;
  const generateItem = initGenerateItem({
    starts,
    ends,
    stackedProbabilities,
    pathInnerWidth,
  });

  function updateItems(elapsed) {
    const xProgressAccessor = (d) => (elapsed - d.time) / itemFlowDuration;

    if (items.length <= itemCountMax) {
      items = [
        ...items,
        ...d3
          .range(itemCountIncrement)
          .map(() => generateItem(elapsed, selectedCategories)),
      ];
    }

    let visibleItems = [];
    let finishedItems = [];
    items.forEach((d) => {
      if (xProgressAccessor(d) < 1) {
        visibleItems.push(d);
      } else {
        finishedItems.push(d);
      }
    });

    if (finishedItems.length >= itemCountMax) {
      d3.timeout(() => {
        timer.stop();
      }, 1000); // Add some buffering time to make sure all animations are finished
    }

    visibleItems.forEach((d) => {
      d.x = xScale(xProgressAccessor(d));
      const yStart = yStartScale(startAccessor(d));
      const yEnd = yEndScale(endAccessor(d));
      const yChange = yEnd - yStart;
      const yProgress = yProgressScale(xProgressAccessor(d));
      d.y = yStart + yChange * yProgress + d.yJitter;
    });

    const finishedGrouped = d3.group(
      finishedItems,
      (d) => endAccessor(d),
      (d) => categoryIndexAccessor(d)
    );
    const finishedStats = ends.map((end) => {
      const itemsWithSameEnd = finishedGrouped.get(end);
      let total = 0;
      const value = selectedCategories.map((c, i) => {
        let itemsWithSameCategoryCount = 0;
        if (itemsWithSameEnd && itemsWithSameEnd.has(i)) {
          itemsWithSameCategoryCount = itemsWithSameEnd.get(i).length;
        }
        const stackedCount = [total, (total += itemsWithSameCategoryCount)];
        return {
          key: i,
          value: {
            count: itemsWithSameCategoryCount,
            stackedCount,
          },
        };
      });
      value.forEach(({ key, value }) => {
        value.percentage = value.count / (total || 1);
        value.stackedPercentage = value.stackedCount.map(
          (count) => count / (total || 1)
        );
        value.totalCount = total;
      });
      return {
        key: end,
        value,
      };
    });

    drawCanvas(visibleItems, finishedStats);
    drawSVG(finishedStats);
  }

  function drawCanvas(visibleItems, finishedStats) {
    context.save();
    context.clearRect(0, 0, width, height);
    // Paths
    context.beginPath();
    pathData.forEach((d) => {
      pathGenerator(d);
    });
    context.lineWidth = pathWidth;
    context.strokeStyle = pathColor;
    context.stroke();
    // Visible items
    selectedCategories.forEach((c, i) => {
      context.beginPath();
      visibleItems
        .filter((d) => categoryIndexAccessor(d) == i)
        .forEach((d) => {
          context.moveTo(d.x, d.y);
          context.arc(d.x, d.y, 6, 0, 2 * Math.PI);
        });
      context.fillStyle = categoryColors[i];
      context.fill();
    });
    // End bars
    finishedStats.forEach(({ key, value }) => {
      context.save();
      context.translate(xScale.range()[1], yEndScale(key) - pathWidth / 2);
      value.forEach(({ key, value }, i) => {
        context.beginPath();
        if (value.totalCount == 0) {
          context.fillStyle = emptyBarColor;
          context.fillRect(0, 0, endBarWidth, pathWidth);
        } else {
          context.fillStyle = categoryColors[i];
          context.fillRect(
            0,
            pathWidth * value.stackedPercentage[0],
            endBarWidth,
            pathWidth *
              (value.stackedPercentage[1] - value.stackedPercentage[0])
          );
        }
      });
      context.restore();
    });
    context.restore();
  }

  function drawSVG(finishedStats) {
    // Path titles and labels
    svg
      .selectAll(".start-title")
      .data([startTitle])
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "path-title start-title")
          .attr("x", xScale.range()[0])
          .attr("y", margin.top - 10)
          .text((d) => d)
      );
    svg
      .selectAll(".end-title")
      .data([endTitle])
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "path-title end-title")
          .attr("text-anchor", "end")
          .attr("y", margin.top - 10)
          .text((d) => d)
      )
      .attr("x", xScale.range()[1] + endBarWidth);
    svg
      .selectAll(".start-label")
      .data(starts)
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "path-label start-label")
          .attr("dy", "0.32em")
          .attr("y", (d) => yStartScale(d))
          .attr("x", xScale.range()[0] + 10)
          .text((d) => d)
      );
    svg
      .selectAll(".end-label")
      .data(starts)
      .join((enter) =>
        enter
          .append("text")
          .attr("class", "path-label end-label")
          .attr("dy", "0.32em")
          .attr("y", (d) => yStartScale(d))
          .attr("text-anchor", "end")
          .text((d) => d)
      )
      .attr("x", xScale.range()[1] - 10);

    // Finished stats
    svg
      .selectAll(".end")
      .data(finishedStats, (d) => d.key)
      .join((enter) => enter.append("g").attr("class", "end"))
      .attr(
        "transform",
        (d) =>
          `translate(${xScale.range()[1] + endBarWidth + 10},${yEndScale(
            d.key
          )})`
      )
      .selectAll(".stats")
      .data(
        (d) => d.value,
        (d) => d.key
      )
      .join((enter) =>
        enter
          .append("g")
          .attr("class", "stats")
          .attr(
            "transform",
            (d, i) =>
              `translate(${
                ((margin.right - margin.left - endBarWidth - 10) / 2) * (i + 1)
              },0)`
          )
          .attr("text-anchor", "end")
          .call((g) =>
            g.append("text").attr("class", (d, i) => `stat-count category-${i}`)
          )
          .call((g) =>
            g
              .append("text")
              .attr("class", (d, i) => `stat-percentage`)
              .attr("dy", "1.2em")
          )
      )
      .call((g) =>
        g.select(".stat-count").text((d) => formatCount(d.value.count))
      )
      .call((g) =>
        g
          .select(".stat-percentage")
          .text((d) => formatPercentage(d.value.percentage))
      );
  }

  function simulate(selected) {
    selectedCategories = selected;
    items = [];
    timer = d3.timer(updateItems);
  }

  return { simulate };
}

function initGenerateItem({
  starts,
  ends,
  stackedProbabilities,
  pathInnerWidth,
}) {
  let index = -1;
  const getRandomCategoryIndex = getRandomFrom([0, 1]);
  const getRandomStart = getRandomFrom(starts);
  const timeJitter = d3.randomUniform(-0.1, 0.1);
  const yJitter = d3.randomUniform(-pathInnerWidth / 2, pathInnerWidth / 2);
  return function (elapsed, currentCategories) {
    index++;
    const categoryIndex = getRandomCategoryIndex();
    const start = getRandomStart();
    const category = currentCategories[categoryIndex];
    const key = getStackedProbabilitiesKey({ category, start });
    const p = stackedProbabilities[key];
    const end = ends[d3.bisect(p, Math.random())];
    return {
      index,
      categoryIndex,
      category,
      start,
      end,
      time: elapsed + timeJitter(),
      yJitter: yJitter(),
    };
  };
}

////////////////////////////////////////////////////////////
//// Helpers ///////////////////////////////////////////////
////////////////////////////////////////////////////////////
function getStackedProbabilitiesKey({ category, start }) {
  return `${category}-${start}`;
}

function getRandomFrom(arr) {
  const getRandomIndex = d3.randomInt(arr.length);
  return function () {
    return arr[getRandomIndex()];
  };
}
