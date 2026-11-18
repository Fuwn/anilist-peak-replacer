export interface DecisionState {
  post: string;
  page_title?: string;
}

interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

type Question = NoulQuestion | ChoiceQuestion;

export const questions = {
  is_slang_praise: {
    type: 'noul',
    instructions: 'Is the word marked ⟦peak⟧ in `post` slang praise that calls something excellent?',
    criteria: {
      true: 'The writer calls something great with slang, as in "this is peak", "peak fiction", "absolute peak", or "Peak!".',
      false:
        'The word means a highest point or maximum, as in "the peak of the series", "it hit its peak", or "peak hours".',
    },
  },
  is_part_of_name: {
    type: 'noul',
    instructions: 'Is the word marked ⟦peak⟧ in `post` part of a proper name, such as the title of a series, a place, or a group?',
    criteria: {
      true: 'It belongs to a name, as in "Martial Peak" or "Hope\'s Peak Academy".',
      false: 'It is an ordinary word, even when it is capitalised, written in capitals, or stands alone.',
    },
  },
  is_about_the_word: {
    type: 'noul',
    instructions: 'Is the writer of `post` discussing the word marked ⟦peak⟧ as a term, rather than using it?',
    criteria: {
      true: 'The writer talks about the term or its meaning, as in "people overuse the word peak" or "what do you even mean by peak?".',
      false: 'The writer uses the word to judge something, even inside quotation marks or in a denial such as "it is not peak".',
    },
  },
  replacement_word: {
    type: 'choice',
    instructions: 'Which word could take the place of ⟦peak⟧ in `post` and keep the sentence grammatical?',
    criteria: {
      great: 'The adjective "great", because ⟦peak⟧ describes something.',
      greatness: 'The noun "greatness", because ⟦peak⟧ stands for a thing on its own.',
    },
  },
} as const satisfies Record<string, Question>;

export type ReplacementWord = keyof (typeof questions)['replacement_word']['criteria'];

export interface Answers {
  isSlangPraise: number;
  isPartOfName: number;
  isAboutTheWord: number;
  replacementWord: ReplacementWord;
}

export const isReplacementWord = (value: unknown): value is ReplacementWord =>
  typeof value === 'string' && Object.hasOwn(questions.replacement_word.criteria, value);

const isProbability = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

export const isAnswers = (value: unknown): value is Answers =>
  typeof value === 'object' &&
  value !== null &&
  'isSlangPraise' in value &&
  isProbability(value.isSlangPraise) &&
  'isPartOfName' in value &&
  isProbability(value.isPartOfName) &&
  'isAboutTheWord' in value &&
  isProbability(value.isAboutTheWord) &&
  'replacementWord' in value &&
  isReplacementWord(value.replacementWord);

export const THRESHOLD_TUNED_MODEL = 'typesafe/jev-1.14';
const YES_THRESHOLD = 0.7;
const NO_THRESHOLD = 0.3;

export const shouldReplace = (answers: Answers): boolean =>
  answers.isSlangPraise >= YES_THRESHOLD &&
  answers.isPartOfName <= NO_THRESHOLD &&
  answers.isAboutTheWord <= NO_THRESHOLD;
