module.exports = {
    "*.{html,js,json,jsx,ts,yml}": ["prettier --check"],
    "src/*.{js,jsx,ts,tsx}": ["eslint --cache --max-warnings 0"],
};
