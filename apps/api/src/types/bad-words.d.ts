declare module 'bad-words' {
  export default class Filter {
    constructor(options?: { list?: string[]; placeHolder?: string });
    isProfane(word: string): boolean;
    clean(text: string): string;
    addWords(...words: string[]): void;
    removeWords(...words: string[]): void;
  }
}
