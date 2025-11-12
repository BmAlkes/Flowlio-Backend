export type Garnish<Type> = {
  [Property in keyof Type]?: [Type[Property]];
};

/**
 * The generic values should only contain string or union of strings
 */

export const extractFormFields = <
  T,
  HANDLED extends boolean = false,
  R = HANDLED extends true ? T : Partial<T>
>(
  fields: Garnish<T>
) => {
  const entries = Object.entries(fields);
  const from = entries.map(([key, value]) => [key, (value as [any])[0]]);
  const data = Object.fromEntries(from) as R;
  return data;
};
