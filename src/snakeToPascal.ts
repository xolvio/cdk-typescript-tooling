export const snakeToPascal = (name: string) => {
  const splitName = name.split("_");
  return splitName.length > 1
    ? splitName
        .map(
          (str) =>
            str.slice(0, 1).toUpperCase() +
            str.slice(1, str.length).toLowerCase()
        )
        .join("")
    : splitName[0];
};
