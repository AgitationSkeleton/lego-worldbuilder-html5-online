global glob

-- The map's own size, in its pixels: the stage's, divided by how far the map is zoomed
-- (mapZoom(), the online layout's; 1 at the game's own scale, less when zoomed out).

on viewTileSize
  z = mapZoom()
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
