const express = require("express");
const app = express.Router();

const config = require("../config/config.json");
const { getVersionInfo } = require("../utils/functions");

// ---- Fortnite game content (news, MOTD, backgrounds) ----
app.get("/content/api/pages/fortnite-game", (req, res) => {
  const { season } = getVersionInfo(req);
  const motd = config.message;

  const newsMessages = motd.enabled
    ? [
        {
          image: "https://cdn2.unrealengine.com/Fortnite/fortnite-game/news/ogfn.png",
          hidden: false,
          _type: "CommonUI Simple Message Base",
          messagetype: "normal",
          title: "OGFN",
          body: motd.text,
          spotlight: false,
        },
      ]
    : [];

  const lobbyStage = season === 10 ? "seasonx" : season >= 27 ? "rufus" : `season${season}`;

  res.json({
    _title: "Fortnite Game",
    _activeDate: "2020-01-01T00:00:00.000Z",
    lastModified: new Date().toISOString(),
    _locale: "en-US",
    _suggestedPrefetch: [],

    emergencynotice: {
      news: { _type: "Battle Royale News", messages: [] },
      _title: "emergencynotice",
      _activeDate: "2020-01-01T00:00:00.000Z",
      lastModified: new Date().toISOString(),
      _locale: "en-US",
    },

    battleroyalenews: {
      news: {
        motds: newsMessages.map((m, i) => ({
          entryType: "Website",
          image: m.image,
          tileImage: m.image,
          hidden: false,
          _type: "CommonUI Simple Message MOTD",
          title: m.title,
          body: m.body,
          id: `ogfn-motd-${i}`,
          sortingPriority: 0,
        })),
        _type: "Battle Royale News",
        messages: newsMessages,
      },
      _title: "battleroyalenews",
      _activeDate: "2020-01-01T00:00:00.000Z",
      lastModified: new Date().toISOString(),
      _locale: "en-US",
    },

    dynamicbackgrounds: {
      backgrounds: {
        backgrounds: [
          { stage: lobbyStage, _type: "DynamicBackground", key: "lobby" },
          { stage: lobbyStage, _type: "DynamicBackground", key: "vault" },
        ],
        _type: "DynamicBackgroundList",
      },
      _title: "dynamicbackgrounds",
      _activeDate: "2020-01-01T00:00:00.000Z",
      lastModified: new Date().toISOString(),
      _locale: "en-US",
    },

    loginmessage: {
      loginmessage: {
        _type: "Login Message",
        message: motd.enabled ? motd.text : "",
        hidden: !motd.enabled,
      },
      _title: "loginmessage",
      _activeDate: "2020-01-01T00:00:00.000Z",
      lastModified: new Date().toISOString(),
      _locale: "en-US",
    },
  });
});

// Generic catch for other content pages
app.get("/content/api/pages/*", (req, res) =>
  res.json({ _title: "empty", _locale: "en-US", _activeDate: "2020-01-01T00:00:00.000Z" })
);

module.exports = app;
