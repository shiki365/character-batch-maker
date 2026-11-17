/*!
 * samples.v1.js - i18n:off. The examples behind "例を入れる", one set per language (no UI)
 *
 * Example data, not texts of the page: each language has its own, written as a user of that language
 * would paste it (the readers understand English labels such as memo: and name as well).
 */
(function (root) {
  "use strict";

  const table = rows => rows.map(r => r.join("\t")).join("\n");

  root.CbSamples = {
    ja: {
      table: table([
        ["名前", "HP", "MP", "SAN", "DEX", "回避", "イニシアチブ", "チャットパレット", "メモ"],
        ["アリス", "12/12", "10", "55/99", "60", "30", "12", '"CCB<={回避} 【回避】\n1d3 【こぶし】"', "大学生。好奇心が強い"],
        ["ボブ", "14", "8", "40/99", "45", "22", "9", "CCB<=50 【こぶし】", "新聞記者"],
        ["黒い影", "20", "", "", "80", "40", "16", "CCB<=70 【かぎ爪】", ""],
      ]),
      memo: [
        "アリス", "HP 12  MP 10  SAN 55/99", "STR 50  DEX 60  DB +0", "回避 30 / こぶし 50 1d3 / 図書館 65", "メモ: 大学生。好奇心が強い", "",
        "ボブ", "HP 14  MP 8  SAN 40/99", "DEX 45", "こぶし 50 1d3+1d4 / 写真術 60", "メモ: 新聞記者", "",
        "黒い影 ×3", "HP 20  DEX 80  装甲 2", "かぎ爪 70 1d6+1d4 / 回避 40",
      ].join("\n"),
    },
    en: {
      table: table([
        ["name", "HP", "MP", "SAN", "DEX", "Dodge", "initiative", "commands", "memo"],
        ["Alice", "12/12", "10", "55/99", "60", "30", "12", '"CCB<={Dodge} 【Dodge】\n1d3 【Fist】"', "A curious student"],
        ["Bob", "14", "8", "40/99", "45", "22", "9", "CCB<=50 【Fist】", "A reporter"],
        ["Black Shadow", "20", "", "", "80", "40", "16", "CCB<=70 【Claw】", ""],
      ]),
      memo: [
        "Alice", "HP 12  MP 10  SAN 55/99", "STR 50  DEX 60  DB +0", "Dodge 30 / Fist 50 1d3 / Library Use 65", "memo: A curious student", "",
        "Bob", "HP 14  MP 8  SAN 40/99", "DEX 45", "Fist 50 1d3+1d4 / Photography 60", "memo: A reporter", "",
        "Black Shadow x3", "HP 20  DEX 80", "Claw 70 1d6+1d4 / Dodge 40",
      ].join("\n"),
    },
    ko: {
      table: table([
        ["name", "HP", "MP", "SAN", "DEX", "회피", "initiative", "commands", "memo"],
        ["앨리스", "12/12", "10", "55/99", "60", "30", "12", '"CCB<={회피} 【회피】\n1d3 【주먹】"', "호기심 많은 대학생"],
        ["밥", "14", "8", "40/99", "45", "22", "9", "CCB<=50 【주먹】", "신문 기자"],
        ["검은 그림자", "20", "", "", "80", "40", "16", "CCB<=70 【발톱】", ""],
      ]),
      memo: [
        "앨리스", "HP 12  MP 10  SAN 55/99", "STR 50  DEX 60  DB +0", "회피 30 / 주먹 50 1d3 / 자료조사 65", "memo: 호기심 많은 대학생", "",
        "밥", "HP 14  MP 8  SAN 40/99", "DEX 45", "주먹 50 1d3+1d4 / 사진술 60", "memo: 신문 기자", "",
        "검은 그림자 x3", "HP 20  DEX 80", "발톱 70 1d6+1d4 / 회피 40",
      ].join("\n"),
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
