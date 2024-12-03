interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface MarkerBase {
  label: string;
  position?: Vector3;
  maxDistance?: number;
  minDistance?: number;
}

interface MarkerSetOptions {
  label?: string;
  toggleable?: boolean;
  defaultHidden?: boolean;
  sorting?: number;
}

interface POIMarkerOptions extends MarkerBase {
  icon?: string;
}

interface HTMLMarkerOptions extends MarkerBase {
  html: string;
}

interface LineMarkerOptions extends MarkerBase {
  line: Vector3[];
  lineWidth?: number;
  lineColor?: Color;
}

interface ShapeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

interface ExtrudeMarkerOptions extends MarkerBase {
  shape: Vector3[];
  shapeMinY: number;
  shapeMaxY: number;
  lineWidth?: number;
  lineColor?: Color;
  fillColor?: Color;
}

export function createBlueMapAPI(
  sendToMinecraft: (data: unknown) => Promise<unknown>,
  log: (message: string) => void
) {
  return {
    // Marker Set Management
    async createMarkerSet(id: string, options: MarkerSetOptions = {}) {
      return await sendToMinecraft({
        type: "bluemap",
        subcommand: "createSet",
        arguments: {
          id,
          data: JSON.stringify({
            label: options.label ?? id,
            toggleable: options.toggleable ?? true,
            defaultHidden: options.defaultHidden ?? false,
            sorting: options.sorting ?? 0
          })
        }
      });
    },

    async removeMarkerSet(id: string) {
      return await sendToMinecraft({
        type: "bluemap",
        subcommand: "removeSet",
        arguments: { id }
      });
    },

    async listMarkerSets() {
      return await sendToMinecraft({
        type: "bluemap",
        subcommand: "listSets"
      });
    },

    // Marker Management
    async addMarker(markerSet: string, id: string, type: string, data: unknown) {
      return await sendToMinecraft({
        type: "bluemap",
        subcommand: "add",
        arguments: {
          markerset: markerSet,
          markerid: id,
          type: type,
          data: JSON.stringify(data)
        }
      });
    },

    async removeMarker(markerSet: string, id: string) {
      return await sendToMinecraft({
        type: "bluemap",
        subcommand: "remove",
        arguments: {
          markerset: markerSet,
          markerid: id
        }
      });
    },

    // Helper methods for different marker types
    async addPOI(set: string, id: string, options: POIMarkerOptions) {
      return this.addMarker(set, id, "poi", options);
    },

    async addHTML(set: string, id: string, options: HTMLMarkerOptions) {
      return this.addMarker(set, id, "html", options);
    },

    async addLine(set: string, id: string, options: LineMarkerOptions) {
      return this.addMarker(set, id, "line", options);
    },

    async addShape(set: string, id: string, options: ShapeMarkerOptions) {
      return this.addMarker(set, id, "shape", options);
    },

    async addExtrude(set: string, id: string, options: ExtrudeMarkerOptions) {
      return this.addMarker(set, id, "extrude", options);
    }
  };
}
