import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        outlook: {
          blue: '#0078d4',
          lightBlue: '#c7e0f4',
          hover: '#f3f2f1',
          selected: '#e1dfdd',
          border: '#edebe9',
          text: '#323130',
          textLight: '#605e5c',
        }
      }
    },
  },
  plugins: [],
}
export default config
