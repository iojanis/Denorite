// ANSI escape codes with bright and dim variants for better color matching
const COLORS = {
  RESET: "\x1b[0m",
  CORK_BROWN: "\x1b[38;5;130m", // Dark orange/brown for cork
  GLASS_BLUE: "\x1b[38;5;153m", // Light blue for glass
  POTION_PINK: "\x1b[38;5;218m", // Light pink for main potion
  POTION_BRIGHT: "\x1b[38;5;213m", // Brighter pink for highlights
  POTION_DIM: "\x1b[38;5;182m", // Dimmer pink for shadows
  HIGHLIGHT: "\x1b[38;5;255m", // Bright white for sparkles
};

const potionArt = [
  "                                                            ",
  "                           .......                          ",
  "                          :ooooool;;;.                      ",
  "                      .,,,odddddddlll:'''                   ",
  "                      cXXX0OOOOOOOOOO0000.                  ",
  "                      :KKKxooooooolllx000.                  ",
  "                      ;000l;;;;;;;,,,o000.                  ",
  "                      .'''oxxx::::ccc;'''                   ",
  "                          d000ccccooo'                      ",
  "                          d000;;;:ooo'                      ",
  "                          d000;;;:ooo'                      ",
  "                      ;000l:::;;;;;;;:ccc                   ",
  "                      cXXXl;;;;;;;;;;cooo.                  ",
  "                  .XXXOdddO000dddo;;;:ccclooo               ",
  "               .. ,XXXOdddOOOOdddo:::cllloooo               ",
  "               XXXKdddk000occcOOOOOOO0XXXxdddooo:           ",
  "               XXXKdddk000dlllOOOOOOOKXXXOxxxooo:           ",
  "               XXXKdddk000OOOOXXXXXXXXXXXXXXXooo:           ",
  "               XXX0dddk0000000XXXXNNNXXXXXXXXooo:           ",
  "               000OdddxOOOKXXXXXXXWWWNXXXXXXXooo:           ",
  "               xxxxxxxO000XXXXNNNNWWWNNNNK000ooo:           ",
  "               ooodOOO0XXXXXXXWWWWWWWWWWW0OOOooo:           ",
  "               ...'dddk000XNNNWWWWWWWX000xddd....           ",
  "                  .oooxOOOXWWWWWWWWWWKOOOdooo               ",
  "                   ...,ddddxxxxxxxxxxdddd....               ",
  "                      'oooooooooooooooooo.                  ",
  "                                                            ",
  "                                                            ",
];

export function printColoredPotion() {
  potionArt.forEach((line, lineIndex) => {
    let coloredLine = "";

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      // Determine if we're in the cork area (top 3 lines where 'o' appears)
      const isInCorkArea = lineIndex < 4 && char === "o";

      switch (char) {
        // Cork - only at the top
        case "o":
          coloredLine += isInCorkArea
            ? COLORS.CORK_BROWN + char
            : COLORS.GLASS_BLUE + char;
          break;
        // Glass outline and details
        case "c":
        case ":":
        case ";":
          coloredLine += COLORS.GLASS_BLUE + char;
          break;
        // Potion liquid - brighter parts
        case "X":
        case "K":
        case "N":
        case "W":
          coloredLine += COLORS.POTION_BRIGHT + char;
          break;
        // Shadows and depth
        case "d":
        case "O":
          coloredLine += COLORS.POTION_DIM + char;
          break;
        // Highlights and sparkles
        case ".":
        case "'":
          coloredLine += COLORS.HIGHLIGHT + char;
          break;
        default:
          coloredLine += char;
      }
    }
    console.log(coloredLine + COLORS.RESET);
  });
}
const COLORS2 = {
  RESET: "\x1b[0m",
  BLUE: "\x1b[38;5;61m",
  PINK: "\x1b[38;5;78m",
  WHITE: "\x1b[38;5;255m",
  GRAY: "\x1b[38;5;245m",
};

const header = [
  " ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗ ██╗████████╗███████╗",
  " ██╔══██╗██╔════╝████╗  ██║██╔═══██╗██╔══██╗██║╚══██╔══╝██╔════╝",
  " ██║  ██║█████╗  ██╔██╗ ██║██║   ██║██████╔╝██║   ██║   █████╗  ",
  " ██║  ██║██╔══╝  ██║╚██╗██║██║   ██║██╔══██╗██║   ██║   ██╔══╝  ",
  " ██████╔╝███████╗██║ ╚████║╚██████╔╝██║  ██║██║   ██║   ███████╗",
  " ╚═════╝ ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝",
];

export function printHeader() {
  // Print empty line before header
  console.log("");

  // Create an array of gradually brightening grays
  const gradientColors = [
    "\x1b[38;5;240m", // Darkest gray
    "\x1b[38;5;243m",
    "\x1b[38;5;247m",
    "\x1b[38;5;251m",
    "\x1b[38;5;253m",
    "\x1b[38;5;255m", // White
  ];

  // Print each line of the DENORITE header with gradient effect
  header.forEach((line, index) => {
    console.log(gradientColors[index] + line + COLORS2.RESET);
  });

  // Print empty line after header
  console.log("");
}
