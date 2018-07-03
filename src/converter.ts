import * as csvParser from 'csv-parse';
import * as xml2js from 'xml2js';
import * as fs from 'fs';
import * as util from 'util';

const readFile = util.promisify(fs.readFile);
const parseXml = util.promisify(xml2js.parseString);

const templateAttributeIdentifier = 'csv2xmlRepeat';
const containsTemplateExpressionRegex = /\${.*}/;

interface ReplaceXmlLocation {
    value: string,
    index: number,
    parent: object
}

export default class Converter {

    private xmlRepeatTemplate;
    private xmlRepeatEntryPoint;
    private xmlTemplate;
    private xmlReplaceLocations: ReplaceXmlLocation[];
    private xmlBuilder = new xml2js.Builder();

    constructor(private delimiter: string, private xmlTemplatePath: string, private csvInputPath: string, private outputPath: string) {}

    public async init() {
        try {
            const xmlTemplateCode = await readFile(this.xmlTemplatePath);
            this.xmlTemplate = await parseXml(xmlTemplateCode);

            const [xmlRepeatNode, xmlRepeatNodeEntry] = this.getXMLRepeatNodeAndEntry(this.xmlTemplate);
            this.xmlRepeatTemplate = JSON.parse(JSON.stringify(xmlRepeatNode));

            (xmlRepeatNodeEntry as any[]).length = 0; // This clears the array
            this.xmlRepeatEntryPoint = xmlRepeatNodeEntry;

            this.xmlReplaceLocations = Converter.getTemplateReplaceLocations(this.xmlRepeatTemplate);

        } catch(error) {
            if(error instanceof Error) {
                error.message = 'Could not initialize converter: ' + error.message;
            }
            throw error;
        }
    }

    private getXMLRepeatNodeAndEntry(xml): [Object, Object] | null {
        const rootNode = xml[Object.keys(xml)[0]];

        const getXMLRepeatNodeRecursive = (nodeList): [Object, Object] | null => {
            for(const node of nodeList) {
                for(let [nodeName, childNodeList] of Object.entries(node)) {
                    if(nodeName === '$') {
                        if(childNodeList[templateAttributeIdentifier] !== undefined) {
                            return [node, nodeList];
                        }
                        continue;
                    }

                    if(!(childNodeList instanceof Array)) {
                        continue;
                    }

                    const result = getXMLRepeatNodeRecursive(childNodeList);
                    if (result !== null) {
                        return result;
                    }
                }
            }

            return null;
        };

        for(const childNode of Object.values(rootNode)) {
            const result = getXMLRepeatNodeRecursive(childNode);
            if(result !== null) {
                delete result[0]['$'][templateAttributeIdentifier];
                return result;
            }
        }

        return null;
    }

    private static getTemplateReplaceLocations(template: object): ReplaceXmlLocation[] {
        let replaceLocations = [];

        const getTemplateReplaceLocationsRecurse = (node: object | string | string[] | object[], parent: object, index: number | string) => {
            if(typeof node === 'string') { // The node is a direct value
                if(node.match(containsTemplateExpressionRegex) !== null) { // Check if the value contains ${}
                    replaceLocations.push({
                        value: node,
                        index: index,
                        parent: parent
                    })
                }
            } else if(node instanceof Array) { // The node is not a value and can have children
                for(let i = 0; i < node.length; i++) {
                    getTemplateReplaceLocationsRecurse(node[i], node, i);
                }
            } else { // The node must be an object
                for(const [key, child] of Object.entries(node)) {
                    getTemplateReplaceLocationsRecurse(child, node, key);
                }
            }
        };

        getTemplateReplaceLocationsRecurse(template, null, null);

        return replaceLocations;
    }

    public async run() {
        let csv = await this.getCsvData();
        let records = Converter.getRecordMap(csv);

        for(const record of records) {
            this.xmlRepeatEntryPoint.push(this.getEvaluatedXmlNode(record));
        }

        let result = this.xmlBuilder.buildObject(this.xmlTemplate);

        fs.writeFileSync(this.outputPath, result);
    }

    private getEvaluatedXmlNode(row: {[key: string]: string}): object { // The variable row is available inside the eval
        //This function is available inside the eval
        let deleteSubNode = false;
        const condition = function(condition) {
            if(condition && condition !== '0') {
                return '';
            }

            deleteSubNode = true;
        };

        for(let replaceLocation of this.xmlReplaceLocations) {
            try {
                let result = eval('`' + replaceLocation.value + '`');

                if (!deleteSubNode) {
                    replaceLocation.parent[replaceLocation.index] = result
                } else {
                    if (replaceLocation.parent instanceof Array) {
                        replaceLocation.parent.splice(replaceLocation.index, 1); // TODO: the index stuff will fail, if a deletion occurs on the same parent twice, but only on arrays e.g. same tag name multiple times
                    } else {
                        delete replaceLocation.parent[replaceLocation.index];
                    }
                    deleteSubNode = false;
                }
            } catch(error) {
                throw new Error('There was an error in your xml template javascript evaluation: ' + error.message + '\r\n at ' + JSON.stringify(replaceLocation.parent[replaceLocation.index]));
            }
        }

        return JSON.parse(JSON.stringify(this.xmlRepeatTemplate));
    }

    private static getRecordMap(data: string[][]): {[key: string]: string}[] {
        let records: {}[] = [];

        let header: string[];
        for(let row of data) {
            if(header === undefined) {
                header = row;
                continue;
            }

            const record = new Map<string, string>();
            for(let i = 0; i < header.length; i++) {
                record[header[i]] = row[i];
            }

            records.push(record);
        }

        return records;
    }

    private getCsvData(): Promise<string[][]> {
        return new Promise((resolve, reject) => {
            fs.createReadStream(this.csvInputPath).pipe(csvParser({delimiter: this.delimiter}, (err, data) => {
                if(err) {
                    reject(err);
                }

                resolve(data);
            }));
        })
    }

}