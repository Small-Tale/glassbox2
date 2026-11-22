// function phantom() {}
export const View = () => <p>phantom</p>;
export class Controller {
  resolve() { return 'class phantom {}'; }
}
export async function fetchValue() { return 1; }
