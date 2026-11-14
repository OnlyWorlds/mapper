// Written by walk/demos.mjs from keyless reads of OnlyWorlds on 2026-11-14: the public demo worlds
// the home shows a stranger, with the cards their rows show (the home's order, src/core/home.ts). A
// stranger's home reads nothing; a press on a card reads the world live. Run it again when a demo
// world's maps change.
import type { MapCard } from './home';

export interface DemoWorld {
  id: string;
  name: string;
  /** A few words after the name. */
  words: string;
  /** How many maps the world has. */
  total: number;
  cards: MapCard[];
}

export const DEMOS: readonly DemoWorld[] = [
  {
    id: "0695db52-5433-7332-8000-db7fe10da375",
    name: "Moppetopia",
    words: "a small demo world",
    total: 3,
    cards: [
      {
        id: "01a1206b-efde-7a5c-8956-d0b871776154",
        name: "Moppetopia Space Map",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/moppetopia/maps/moppetopia-space-v2.webp"
      },
      {
        id: "01a1ccc7-9797-7f0a-adb2-568adf5dcd60",
        name: "Moppetopia: layout",
        kind: "layout3d",
        words: "a layout · 3D",
        picture: null
      },
      {
        id: "069620b8-a566-7850-8000-2afcac2701e5",
        name: "MoppetopiaMap",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/moppetopia/maps/moppetopia.webp"
      }
    ]
  },
  {
    id: "49501a68-179b-4a3c-8eaf-7f46f73d5fd2",
    name: "Sikelia",
    words: "a large one, an island of city plans",
    total: 214,
    cards: [
      {
        id: "3be1f73c-f903-4e76-bb10-08c51439ca68",
        name: "Sikelia",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/sikelia/maps/sikelia-world-f9bd4f3e-ext500.webp"
      },
      {
        id: "01a1cce7-b11c-7cbe-816d-50e3e66308c2",
        name: "Sikelia: layout",
        kind: "layout3d",
        words: "a layout · 3D",
        picture: null
      },
      {
        id: "01a0e8bb-9673-7532-acfa-86392a958f53",
        name: "Map of Abakainon",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/sikelia/maps/abakainon-base-clear-9aac683e.png"
      },
      {
        id: "70549492-e894-472e-83df-721b0fd78da1",
        name: "Map of Abolla",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/sikelia/maps/abolla-base-clear-265ced21.png"
      },
      {
        id: "1a122863-07e3-4b68-90a4-75109aa62ebe",
        name: "Map of Adrane",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/sikelia/maps/adrane-base-clear-15231bfd.png"
      },
      {
        id: "01a0e83e-327e-7360-beaf-39e4bcdc8205",
        name: "Map of Adranos",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/sikelia/maps/adranos-base-clear-bda4cf1b.png"
      }
    ]
  },
  {
    id: "721d154b-43f3-4cc1-b7b4-7ea2b83c401e",
    name: "Blood Meridian: the scalp country, 1849-50",
    words: "a novel's route, mapped",
    total: 3,
    cards: [
      {
        id: "01a1ccc5-cd05-7983-82ab-970256e9ecdc",
        name: "Blood Meridian: the scalp country, 1849-50: layout",
        kind: "layout3d",
        words: "a layout · 3D",
        picture: null
      },
      {
        id: "01a13c6f-881a-7650-8e71-90757741ab9c",
        name: "The itinerary 1849-50",
        kind: "picture",
        words: "a picture",
        picture: "https://media.onlyworlds.com/worlds/blood-meridian/itinerary-base-1849.webp"
      },
      {
        id: "01a1b2d8-cf2d-7cef-a8c5-ef2da3662ca8",
        name: "The way south, 1847-49",
        kind: "plan",
        words: "a plan",
        picture: null
      }
    ]
  }
];
