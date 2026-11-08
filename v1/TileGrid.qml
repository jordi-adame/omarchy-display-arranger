pragma ComponentBehavior: Bound

import QtQuick
import "Model.js" as Model

// Grid of arrangement tiles. Plain QtQuick (plus the plain-JS Model.js for
// the caption fit) so the preview harness can render it without the Omarchy
// shell; Panel.qml passes the theme in.
//
// Each tile pictures its arrangement: every display as a rectangle at its
// logical size and relative position. The laptop is filled and carries a
// laptop glyph; externals are outlined and carry the longest of their
// caption forms that fits (Model.captionForms: "Northwind 15.3″", then
// "Northwind 15″", then "Northwind"; with the serial tail only when two
// displays read the same: "Northwind 0742", then "0742"), the last form
// shrunk to Model.CAPTION_MIN_PX and then elided ("View…") when even that
// does not fit. The serial tag is never a caption. Hovering a rectangle
// shows its full label in the tooltip Panel.qml supplies. The tile for the
// arrangement on screen now has an accent border and fill.
Item {
  id: grid

  property var tiles: []
  // Component for a hover tooltip over a display rectangle (Omarchy's
  // PanelToolTip); null leaves the rectangles without one.
  property Component tooltipComponent: null
  property string currentId: ""
  property int cursorIndex: -1
  property bool busy: false
  property int columns: 3
  property real spacing: 8
  property real tileAspect: 0.7
  property real radius: 6

  property color foreground: "#cdd6f4"
  property color accent: "#89b4fa"
  property color background: "#1e1e2e"
  property string fontFamily: ""

  signal activated(int index)
  signal hoveredIndex(int index)

  readonly property int rows: Math.ceil(tiles.length / Math.max(1, columns))
  readonly property real tileWidth: Math.max(0, (width - spacing * (columns - 1)) / Math.max(1, columns))
  readonly property real tileHeight: Math.round(tileWidth * tileAspect)

  implicitHeight: rows > 0 ? rows * tileHeight + (rows - 1) * spacing : 0

  function tint(c, alpha) {
    return Qt.rgba(c.r, c.g, c.b, alpha)
  }

  Grid {
    id: layout
    columns: grid.columns
    spacing: grid.spacing

    Repeater {
      model: grid.tiles

      Rectangle {
        id: tile
        required property var modelData
        required property int index

        readonly property bool current: modelData.id === grid.currentId
        readonly property bool hot: grid.cursorIndex === index
        readonly property var picture: modelData.drawing
        // Fit the picture inside the tile with a margin, keeping proportions.
        readonly property real pad: Math.round(grid.tileWidth * 0.12)
        readonly property real fit: picture && picture.w > 0 && picture.h > 0
          ? Math.min((width - 2 * pad) / picture.w, (height - 2 * pad) / picture.h)
          : 0
        readonly property real offsetX: (width - picture.w * fit) / 2
        readonly property real offsetY: (height - picture.h * fit) / 2

        width: grid.tileWidth
        height: grid.tileHeight
        radius: grid.radius
        color: current ? grid.tint(grid.accent, 0.16) : (hot ? grid.tint(grid.foreground, 0.08) : "transparent")
        border.width: current ? 2 : 1
        border.color: current ? grid.accent : (hot ? grid.tint(grid.foreground, 0.6) : grid.tint(grid.foreground, 0.22))
        opacity: grid.busy && !current ? 0.6 : 1

        Accessible.role: Accessible.Button
        Accessible.name: modelData.label

        Repeater {
          model: tile.picture ? tile.picture.rects : []

          Rectangle {
            id: screenRect
            objectName: "screenRect"
            required property var modelData

            // A 1 px gap between neighbours so shared edges stay visible.
            x: Math.round(tile.offsetX + (modelData.x - tile.picture.x) * tile.fit) + 1
            y: Math.round(tile.offsetY + (modelData.y - tile.picture.y) * tile.fit) + 1
            width: Math.max(2, Math.round(modelData.w * tile.fit) - 2)
            height: Math.max(2, Math.round(modelData.h * tile.fit) - 2)
            radius: 2
            opacity: modelData.off ? 0.45 : 1
            color: modelData.off ? "transparent"
              : (modelData.laptop ? grid.tint(tile.current ? grid.accent : grid.foreground, 0.55)
                : grid.tint(grid.foreground, modelData.mirror ? 0.10 : 0.16))
            border.width: 1
            border.color: modelData.laptop && !modelData.off
              ? grid.tint(tile.current ? grid.accent : grid.foreground, 0.9)
              : grid.tint(grid.foreground, 0.7)

            // The caption: the first of the display's caption forms that fits
            // the rectangle at the caption size, measured in the caption's
            // font (widths at smaller sizes scaled from the measured one);
            // else the last form, which the Text below shrinks and elides.
            readonly property int captionSize: Math.max(7, Math.min(14, Math.round(height * 0.42)))
            readonly property real captionRoom: Math.max(0, width - 4)
            readonly property var captionFit: {
              var metrics = captionMetrics
              var measured = metrics.font.pixelSize
              return Model.fitCaption(modelData.captions, captionRoom, captionSize, Model.CAPTION_MIN_PX,
                function(text, size) { return metrics.advanceWidth(text) * size / measured })
            }
            // The mirror tile's corner overlay, same forms, its own size.
            readonly property int overlaySize: Math.max(6, Math.min(10, Math.round(height * 0.18)))
            readonly property var overlayFit: {
              var metrics = overlayMetrics
              var measured = metrics.font.pixelSize
              return Model.fitCaption(modelData.captions, captionRoom, overlaySize, Model.OVERLAY_MIN_PX,
                function(text, size) { return metrics.advanceWidth(text) * size / measured })
            }

            FontMetrics {
              id: captionMetrics
              font.family: grid.fontFamily
              font.pixelSize: screenRect.captionSize
              font.bold: true
            }
            FontMetrics {
              id: overlayMetrics
              font.family: grid.fontFamily
              font.pixelSize: screenRect.overlaySize
              font.bold: true
            }

            Text {
              objectName: "caption"
              anchors.centerIn: parent
              width: screenRect.captionRoom
              visible: !screenRect.modelData.mirror && parent.height > 8
              textFormat: Text.PlainText
              horizontalAlignment: Text.AlignHCenter
              // nf-md-laptop / nf-md-laptop_off; externals show their caption.
              text: screenRect.modelData.laptop ? String.fromCodePoint(screenRect.modelData.off ? 0xF06E7 : 0xF0322) : screenRect.captionFit.text
              color: screenRect.modelData.laptop && !screenRect.modelData.off ? grid.background : grid.foreground
              font.family: grid.fontFamily
              font.pixelSize: screenRect.captionSize
              font.bold: !screenRect.modelData.laptop
              // A caption that does not fit at the caption size shrinks to
              // the minimum, then is elided ("View…"); the glyph never does.
              fontSizeMode: screenRect.modelData.laptop ? Text.FixedSize : Text.HorizontalFit
              minimumPixelSize: Model.CAPTION_MIN_PX
              elide: screenRect.modelData.laptop ? Text.ElideNone : Text.ElideRight
            }

            Text {
              objectName: "overlay"
              // The mirrored external shows its caption in its visible top
              // band, right-aligned, with the same fit order.
              visible: screenRect.modelData.mirror
              anchors.right: parent.right
              anchors.top: parent.top
              anchors.rightMargin: 2
              width: screenRect.captionRoom
              textFormat: Text.PlainText
              horizontalAlignment: Text.AlignRight
              text: screenRect.overlayFit.text
              color: grid.foreground
              font.family: grid.fontFamily
              font.pixelSize: screenRect.overlaySize
              font.bold: true
              fontSizeMode: Text.HorizontalFit
              minimumPixelSize: Model.OVERLAY_MIN_PX
              elide: Text.ElideRight
            }

            // Full label on hover: "Northwind 15.3″ (0742)", "Laptop".
            HoverHandler { id: rectHover }
            Loader {
              id: tipLoader
              active: grid.tooltipComponent !== null && rectHover.hovered
              sourceComponent: grid.tooltipComponent
            }
            Binding {
              target: tipLoader.item
              property: "text"
              value: String(screenRect.modelData.label || "")
              when: tipLoader.item !== null
            }
            Binding {
              target: tipLoader.item
              property: "visible"
              value: true
              when: tipLoader.item !== null
            }
          }
        }

        MouseArea {
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: grid.busy ? Qt.BusyCursor : Qt.PointingHandCursor
          onContainsMouseChanged: if (containsMouse) grid.hoveredIndex(tile.index)
          onClicked: if (!grid.busy) grid.activated(tile.index)
        }
      }
    }
  }
}
