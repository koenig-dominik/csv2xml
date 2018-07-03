import * as meow from 'meow';
import * as updateNotifier from 'update-notifier';
import * as fs from 'fs';
import * as path from 'path';
import Converter from './converter';

const cli = meow(`
    Usage
        $ csv2xml source destination -xt

    Options
        --xt, --xmlTemplate   The XML template file path
        --s, --split          Split the output xml into multiple files, the destination path will be a folder
        --vd, --validateDate  Validates dates using the specified format
        --d, --delimiter      CSV delimiter
    Example
        $ csv2xml source/file destination/file
`, {
    flags: {
        xmlTemplate: {
            type: 'string',
            alias: 'xt'
        },
        split: {
            type: 'number',
            alias: 's'
        },
        validateDate: {
            type: 'string',
            alias: 'vd'
        },
        delimiter: {
            type: 'string',
            alias: 'd',
            default: ','
        }
    }
});

updateNotifier(cli).notify();

if (cli.input.length < 2) {
    console.error('Specify source and destination path');
    process.exit(1);
}

if(cli.flags.xmlTemplate === undefined) {
    console.error('Specify the xml template path');
    process.exit(1);
}
cli.flags.xmlTemplate = path.join(process.cwd(), cli.flags.xmlTemplate);
if (!fs.existsSync(cli.flags.xmlTemplate)) {
    console.error(`The specified xml template does not exist (${cli.flags.xmlTemplate})`);
    process.exit(1);
}

if(cli.input[0] === undefined) {
    console.error('Specify the input csv file');
    process.exit(1);
}

cli.input[0] = path.join(process.cwd(), cli.input[0]);
if (!fs.existsSync(cli.input[0])) {
    console.error(`The specified input csv file does not exist (${cli.input[0]})`);
    process.exit(1);
}

if(cli.input[1] === undefined) {
    console.error('Specify the output path');
    process.exit(1);
}

cli.input[1] = path.join(process.cwd(), cli.input[1]);
if (fs.accessSync(path.dirname(cli.input[1]), fs.constants.R_OK | fs.constants.W_OK) !== undefined) {
    console.error(`The specified output path cannot be written to (${path.dirname(cli.input[1])})`);
    process.exit(1);
}

(async () => {
    const converter = new Converter(cli.flags.delimiter, cli.flags.xmlTemplate, cli.input[0], cli.input[1]);
    await converter.init();
    await converter.run();
})();