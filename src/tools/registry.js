// Every tool is one entry here. The shell builds the sidebar from this list and
// loads a tool's script and stylesheet only when its page is opened for the first time.
//
// A tool module exports `mount(section, ctx)`, which fills the <section> with the tool UI.
// It may return { show(), hide() } to react to its page becoming visible or hidden.

const here = path => new URL(path, import.meta.url).href;

export const TOOLS = [
  {
    id: 'channel-packer',
    title: 'Channel Packer',
    short: 'Packer',          // label for the narrow top bar
    icon: 'layers',           // symbol id in the sprite in index.html, without the "i-" prefix
    module: here('./channel-packer/channel-packer.js'),
    css: here('./channel-packer/channel-packer.css'),
  },
  {
    id: 'matcap',
    title: 'MatCap Generator',
    short: 'MatCap',
    icon: 'matcap',
    module: here('./matcap/matcap.js'),
    css: here('./matcap/matcap.css'),
  },
  {
    id: 'kuwahator',
    title: 'Kuwahator',
    short: 'Kuwahara',
    icon: 'brush',
    module: here('./kuwahator/kuwahator.js'),
    css: here('./kuwahator/kuwahator.css'),
  },
  {
    id: 'tile-maker',
    title: 'Tile Maker',
    short: 'Tile',
    icon: 'tile',
    module: here('./tile-maker/tile-maker.js'),
    css: here('./tile-maker/tile-maker.css'),
  },
];
