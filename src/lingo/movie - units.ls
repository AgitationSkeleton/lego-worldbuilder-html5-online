-- A unit's name as the right-hand panel, the unit info bubble and the plans bar show it
-- (tools/merge.py): the game's second Defender (#defender2) is named "Defender", as the
-- first is; here it is "Defender 2", so the two can be told apart.
on unitName uclass, uname
  if uclass[2] = #defender2 then
    return "Defender 2"
  end if
  return uname
end
