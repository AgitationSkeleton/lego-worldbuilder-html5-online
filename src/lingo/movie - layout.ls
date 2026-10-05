global glob

-- The map's own size, in its pixels: the stage's, divided by how far the map is zoomed
-- (mapZoom(), the online layout's; 1 at the game's own scale, less when zoomed out).

-- The tiles the map shows at its zoom now. (The tutorial's, the original's twelve by nine:
-- it points at the map where the original's view puts it, by scrolling as the original
-- does; a bigger stage shows more round that.)
on viewTileSize
  if glob[#tutorialMode] = 1 then
    return [12, 9]
  end if
  return tilesForZoom(mapZoom())
end

-- The tiles the map display keeps a sprite for: as many as the most zoomed-out view shows
-- (mapZoomLeast(), the online layout's), so that zooming needs no new ones.
on viewTileSizeHeld
  return tilesForZoom(mapZoomLeast())
end

on tilesForZoom z
  w = integer((the stageRight - the stageLeft) / z)
  h = integer((the stageBottom - the stageTop) / z)
  return [12 + ((w - 610 + 49) / 50), 9 + ((h - 440 + 49) / 50)]
end

on viewCenter
  z = mapZoom()
  return point(integer((the stageRight - the stageLeft) / 2 / z), integer((the stageBottom - the stageTop) / 2 / z))
end

-- Where the mouse is on the map, in the map's pixels.
on mapMouseLoc
  z = mapZoom()
  return point(integer(the mouseH / z), integer(the mouseV / z))
end

-- Where a place on the original stage's interface is in the online layout (uiShift, the
-- layout's): the tutorial's arrows and click holes are given on the original stage. An
-- anchor ([ax, ay], as the layout anchors the interface) may be given; else the place's
-- own part of the interface decides.
on uiLoc p, anchor
  d = uiShift(p[1], p[2], anchor)
  return p + point(d[1], d[2])
end

on uiRect r, anchor
  if voidp(anchor) then
    d = uiShift((r.left + r.right) / 2, (r.top + r.bottom) / 2)
  else
    d = uiShift(r.left, r.top, anchor)
  end if
  return r + rect(d[1], d[2], d[1], d[2])
end
