import ArrowUp from 'lucide-react-native/icons/arrow-up';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CircleStop from 'lucide-react-native/icons/circle-stop';
import Eye from 'lucide-react-native/icons/eye';
import FileText from 'lucide-react-native/icons/file-text';
import Folder from 'lucide-react-native/icons/folder';
import FolderPlus from 'lucide-react-native/icons/folder-plus';
import Globe from 'lucide-react-native/icons/globe';
import ImageIcon from 'lucide-react-native/icons/image';
import Loader from 'lucide-react-native/icons/loader';
import MessageSquare from 'lucide-react-native/icons/message-square';
import Paperclip from 'lucide-react-native/icons/paperclip';
import Pencil from 'lucide-react-native/icons/pencil';
import Pin from 'lucide-react-native/icons/pin';
import Plus from 'lucide-react-native/icons/plus';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Share2 from 'lucide-react-native/icons/share-2';
import Trash from 'lucide-react-native/icons/trash';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Wrench from 'lucide-react-native/icons/wrench';
import X from 'lucide-react-native/icons/x';

/**
 * Imported one file per icon: pulling the package root would drag every icon
 * in the set into the bundle.
 *
 * The subpath is the file that ships, not the name the component used to have.
 * Icons renamed upstream (`trash-2` to `trash`, `alert-circle` to
 * `circle-alert`) keep a `.d.ts` alias, so a stale path typechecks and then
 * fails at bundle time. `icons.test.ts` guards against that.
 */
export {
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  ImageIcon,
  Loader,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Trash,
  TriangleAlert,
  Wrench,
  X,
};
