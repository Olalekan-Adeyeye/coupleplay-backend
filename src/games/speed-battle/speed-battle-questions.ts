export interface SpeedBattleQuestion {
  id: string;
  question: string;
  options: { text: string; emoji: string }[];
  correctIndex: number;
}

export const SPEED_BATTLE_QUESTIONS: SpeedBattleQuestion[] = [
  {
    id: 'sb1',
    question: 'What colour is a banana?',
    options: [
      { text: 'Red', emoji: '🔴' },
      { text: 'Yellow', emoji: '🟡' },
      { text: 'Blue', emoji: '🔵' },
      { text: 'Green', emoji: '🟢' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb2',
    question: 'How many legs does a spider have?',
    options: [
      { text: '6', emoji: '🕷️' },
      { text: '10', emoji: '🦀' },
      { text: '8', emoji: '🐙' },
      { text: '4', emoji: '🐕' },
    ],
    correctIndex: 2,
  },
  {
    id: 'sb3',
    question: 'What is H₂O commonly known as?',
    options: [
      { text: 'Salt', emoji: '🧂' },
      { text: 'Sugar', emoji: '🍬' },
      { text: 'Water', emoji: '💧' },
      { text: 'Fire', emoji: '🔥' },
    ],
    correctIndex: 2,
  },
  {
    id: 'sb4',
    question: 'Which planet is closest to the Sun?',
    options: [
      { text: 'Venus', emoji: '🌟' },
      { text: 'Mercury', emoji: '☿️' },
      { text: 'Earth', emoji: '🌍' },
      { text: 'Mars', emoji: '🔴' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb5',
    question: 'What do bees make?',
    options: [
      { text: 'Milk', emoji: '🥛' },
      { text: 'Honey', emoji: '🍯' },
      { text: 'Bread', emoji: '🍞' },
      { text: 'Juice', emoji: '🧃' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb6',
    question: 'How many days are in a week?',
    options: [
      { text: '5', emoji: '🖐️' },
      { text: '7', emoji: '📅' },
      { text: '10', emoji: '🔟' },
      { text: '6', emoji: '🎲' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb7',
    question: 'What is the opposite of hot?',
    options: [
      { text: 'Warm', emoji: '🌤️' },
      { text: 'Cold', emoji: '🥶' },
      { text: 'Wet', emoji: '💦' },
      { text: 'Fast', emoji: '💨' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb8',
    question: 'Which animal says "meow"?',
    options: [
      { text: 'Dog', emoji: '🐕' },
      { text: 'Cow', emoji: '🐄' },
      { text: 'Cat', emoji: '🐱' },
      { text: 'Bird', emoji: '🐦' },
    ],
    correctIndex: 2,
  },
  {
    id: 'sb9',
    question: 'What falls down but never breaks?',
    options: [
      { text: 'A glass', emoji: '🥛' },
      { text: 'Night', emoji: '🌙' },
      { text: 'A rock', emoji: '🪨' },
      { text: 'A stick', emoji: '🪵' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb10',
    question: 'Which fruit is always dressed in a tuxedo?',
    options: [
      { text: 'Apple', emoji: '🍎' },
      { text: 'Penguin', emoji: '🐧' },
      { text: 'Orange', emoji: '🍊' },
      { text: 'Banana', emoji: '🍌' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb11',
    question: 'What has hands but can\'t clap?',
    options: [
      { text: 'A clock', emoji: '🕰️' },
      { text: 'A glove', emoji: '🧤' },
      { text: 'A puppet', emoji: '🎭' },
      { text: 'A shadow', emoji: '👤' },
    ],
    correctIndex: 0,
  },
  {
    id: 'sb12',
    question: 'What gets wetter the more it dries?',
    options: [
      { text: 'A towel', emoji: '🏖️' },
      { text: 'The sun', emoji: '☀️' },
      { text: 'A fish', emoji: '🐟' },
      { text: 'Ice', emoji: '🧊' },
    ],
    correctIndex: 0,
  },
  {
    id: 'sb13',
    question: 'What can you catch but never throw?',
    options: [
      { text: 'A ball', emoji: '⚾' },
      { text: 'A cold', emoji: '🤧' },
      { text: 'A fish', emoji: '🎣' },
      { text: 'A train', emoji: '🚂' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb14',
    question: 'What has a face but can\'t smile?',
    options: [
      { text: 'A baby', emoji: '👶' },
      { text: 'A clock', emoji: '🕐' },
      { text: 'A painting', emoji: '🖼️' },
      { text: 'A mirror', emoji: '🪞' },
    ],
    correctIndex: 1,
  },
  {
    id: 'sb15',
    question: 'What building has the most stories?',
    options: [
      { text: 'A library', emoji: '📚' },
      { text: 'A skyscraper', emoji: '🏙️' },
      { text: 'A castle', emoji: '🏰' },
      { text: 'A school', emoji: '🏫' },
    ],
    correctIndex: 0,
  },
];

export function pickSpeedBattleQuestions(count: number): SpeedBattleQuestion[] {
  const shuffled = [...SPEED_BATTLE_QUESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
