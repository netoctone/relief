## Example

    $ node relief.js example

Will search for `*.rts` files in `example/` folder and generate `*.actions.ts` and `*.reducer.ts`

Example of an `.rts` file:

```
import { Book } from '../../book.model';

export const initialLoading = false;

class Book extends Reducer {
  loading: boolean = initialLoading;
  query: string = '';
  book: Book | undefined = undefined;

  @MergeActions('SearchInit')
  SearchStart(SEARCH_START = '[Book] search start'): string {
    return {
      ...state,
      query: action.payload,
      loading: true
    };
  }

  SearchSuccess(): Book {
    return {
      ...state,
      book: action.payload,
      loading: false
    };
  }
}
```
