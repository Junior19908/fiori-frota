sap.ui.define([
  "sap/viz/ui5/controls/VizFrame",
  "sap/viz/ui5/data/FlattenedDataset",
  "sap/viz/ui5/controls/common/feeds/FeedItem",
  "sap/ui/model/json/JSONModel",
  "sap/suite/ui/microchart/LineMicroChart",
  "sap/suite/ui/microchart/LineMicroChartPoint",
  "sap/suite/ui/microchart/ComparisonMicroChart",
  "sap/suite/ui/microchart/ComparisonMicroChartData"
], function (
  VizFrame,
  FlattenedDataset,
  FeedItem,
  JSONModel,
  LineMicroChart,
  LineMicroChartPoint,
  ComparisonMicroChart,
  ComparisonMicroChartData
) {
  "use strict";

  function createVizFrame(type, datasetConfig, properties, dataCollection) {
    const frame = new VizFrame({
      uiConfig: {
        applicationSet: "fiori"
      },
      width: "100%",
      height: "22rem",
      vizType: type
    });

    frame.setDataset(new FlattenedDataset(datasetConfig));
    if (properties) {
      frame.setVizProperties(properties);
    }
    const data = Array.isArray(dataCollection) ? dataCollection : [];
    frame.setModel(new JSONModel(data));
    return frame;
  }

  function applyFeeds(frame, feedsConfig) {
    (feedsConfig || []).forEach(function (feed) {
      frame.addFeed(new FeedItem(feed));
    });
    return frame;
  }

  function buildColumn(options) {
    const opts = options || {};
    const measures = (opts.measures || []).map(function (measure) {
      return {
        name: measure.name,
        value: "{" + measure.path + "}"
      };
    });
    const datasetConfig = {
      data: {
        path: "/"
      },
      dimensions: [{
        name: opts.dimensionName || "Periodo",
        value: "{" + (opts.dimensionPath || "mes") + "}"
      }],
      measures: measures
    };

    return applyFeeds(createVizFrame("column", datasetConfig, opts.properties, opts.data), [{
      uid: "categoryAxis",
      type: "Dimension",
      values: [opts.dimensionName || "Periodo"]
    }].concat((opts.measures || []).map(function (measure) {
      return {
        uid: measure.feed || "valueAxis",
        type: "Measure",
        values: [measure.name]
      };
    })));
  }

  function buildLine(options) {
    const opts = options || {};
    const measures = (opts.measures || []).map(function (measure) {
      return {
        name: measure.name,
        value: "{" + measure.path + "}"
      };
    });
    const datasetConfig = {
      data: {
        path: "/"
      },
      dimensions: [{
        name: opts.dimensionName || "Periodo",
        value: "{" + (opts.dimensionPath || "mes") + "}"
      }],
      measures: measures
    };

    return applyFeeds(createVizFrame("line", datasetConfig, opts.properties, opts.data), [{
      uid: "categoryAxis",
      type: "Dimension",
      values: [opts.dimensionName || "Periodo"]
    }].concat((opts.measures || []).map(function (measure) {
      return {
        uid: measure.feed || "valueAxis",
        type: "Measure",
        values: [measure.name]
      };
    })));
  }

  function buildComparison(options) {
    const opts = options || {};
    const chart = new ComparisonMicroChart({
      size: opts.size || "Responsive"
    });
    (opts.items || []).forEach(function (item) {
      chart.addData(new ComparisonMicroChartData({
        title: item.title || "",
        value: Number(item.value || 0),
        color: item.color || "Neutral"
      }));
    });
    return chart;
  }

  function buildSparklines(options) {
    const opts = options || {};
    const chart = new LineMicroChart({
      size: opts.size || "Responsive",
      minXValue: 0
    });
    (opts.points || []).forEach(function (value, index) {
      chart.addPoint(new LineMicroChartPoint({
        x: index + 1,
        y: Number(value || 0)
      }));
    });
    return chart;
  }

  return {
    buildColumn: buildColumn,
    buildLine: buildLine,
    buildComparison: buildComparison,
    buildSparklines: buildSparklines
  };
});
