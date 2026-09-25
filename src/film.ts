import { runFilm } from "./film-run";

function line(label: string, value: string): void {
  console.log(`    ${label.padEnd(14)} ${value}`);
}

async function main(): Promise<number> {
  console.log("C3 90-second cut");
  console.log("");
  const film = await runFilm();
  for (const item of film.beats) {
    console.log(`[${item.n}] ${item.title}`);
    console.log(`    ${item.mode}`);
    for (const row of item.lines) {
      line(row.label, row.value);
    }
    console.log(item.passed ? item.stamp : `FAIL ${item.stamp}`);
    console.log("");
  }
  console.log(film.note);
  if (!film.passed) {
    console.log("FILM_FAILED");
    return 1;
  }
  console.log("FILM_PASSED");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "film failed");
    process.exitCode = 1;
  });
