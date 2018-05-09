import * as csvParser from 'csv-parse';
import * as xmlBuilder from 'xmlbuilder';
import * as xml2js from 'xml2js';
import * as fs from 'fs';

export default class Converter {

    private xmlParser = new xml2js.Parser();

    constructor(private delimiter: string, private xmlTemplatePath: string) {
        fs.readFile(__dirname + xmlTemplatePath, (err, data) => {
            this.xmlParser.parseString(data, (err, result) => {
                console.log(result);
            });
        });
    }

    public run() {
        //csvParser.
    }

}