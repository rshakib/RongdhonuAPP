import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  StatusBar as RNStatusBar,
  Alert,
  Modal,
  BackHandler
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AddItemScreen({
  table = { items: [] },
  menuItems,
  userRole,
  onBack,
  onUpdateTableItems,
  onUpdateMenuPrice,
  onAddMenuItem,
  onDeleteMenuItem,
  editMode = false
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('সব'); // 'সব', 'বার্গার', 'ফ্রাই', etc.
  
  // Local state to track selected quantities for items not yet in cart (defaults to 1)
  const [localQuantities, setLocalQuantities] = useState({});

  // Price Edit State (Owner Only)
  const [priceEditModalVisible, setPriceEditModalVisible] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState(null);
  const [newPriceValue, setNewPriceValue] = useState('');

  // Add New Item State
  const [addItemModalVisible, setAddItemModalVisible] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('বার্গার');

  // Android Back Handler for Modals
  useEffect(() => {
    const backAction = () => {
      if (priceEditModalVisible) { setPriceEditModalVisible(false); return true; }
      if (addItemModalVisible) { setAddItemModalVisible(false); return true; }
      return false; // Let App.js handle screen back
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [priceEditModalVisible, addItemModalVisible]);

  if (!table) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#FFF', fontSize: 16 }}>টেবিল পাওয়া যায়নি বা লোড হচ্ছে...</Text>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 20, padding: 12, backgroundColor: '#FFB703', borderRadius: 8 }}>
          <Text style={{ color: '#000', fontWeight: 'bold' }}>ফিরে যান</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const cartItems = table.items || [];

  // Calculate dynamic totals for the sticky bottom bar
  const totalAmount = cartItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalItemsCount = cartItems.reduce((sum, item) => sum + item.qty, 0);

  // Get quantity of a menu item currently in the cart
  const getCartQty = (itemName) => {
    const item = cartItems.find(i => i.name === itemName);
    return item ? item.qty : 0;
  };

  // Get selected local quantity (defaults to 1)
  const getLocalQty = (itemName) => {
    return localQuantities[itemName] || 1;
  };

  // Adjust local quantity (before adding to cart)
  const handleIncreaseLocalQty = (itemName) => {
    setLocalQuantities({
      ...localQuantities,
      [itemName]: getLocalQty(itemName) + 1
    });
  };

  const handleDecreaseLocalQty = (itemName) => {
    const current = getLocalQty(itemName);
    if (current > 1) {
      setLocalQuantities({
        ...localQuantities,
        [itemName]: current - 1
      });
    }
  };

  // Adjust cart quantity directly
  const handleIncreaseCartQty = (itemName) => {
    const updated = cartItems.map(item =>
      item.name === itemName ? { ...item, qty: item.qty + 1 } : item
    );
    onUpdateTableItems(table.id, updated);
  };

  const handleDecreaseCartQty = (itemName) => {
    const item = cartItems.find(i => i.name === itemName);
    if (!item) return;

    let updated;
    if (item.qty > 1) {
      updated = cartItems.map(i =>
        i.name === itemName ? { ...i, qty: i.qty - 1 } : i
      );
    } else {
      // Remove item if quantity becomes 0
      updated = cartItems.filter(i => i.name !== itemName);
    }
    onUpdateTableItems(table.id, updated);
  };

  // Add Item action
  const handleAddItem = (menuItem) => {
    const isPizza = menuItem.category === 'পিজ্জা';
    const qtyToAdd = getLocalQty(menuItem.name);

    if (isPizza) {
      Alert.alert(
        "পিৎজা অর্ডার নোটিশ",
        "পিৎজা কমপক্ষে ২–২.৫ ঘন্টা আগে অর্ডার করতে হবে। আপনি কি অর্ডারটি নিশ্চিত করতে চান?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: () => confirmAddItem(menuItem, qtyToAdd) }
        ]
      );
    } else {
      confirmAddItem(menuItem, qtyToAdd);
    }
  };

  const confirmAddItem = (menuItem, qty) => {
    const existingIndex = cartItems.findIndex(i => i.name === menuItem.name);
    const updated = [...cartItems];
    
    if (existingIndex > -1) {
      updated[existingIndex].qty += qty;
    } else {
      updated.push({ name: menuItem.name, price: menuItem.price, qty: qty });
    }
    
    onUpdateTableItems(table.id, updated);
    
    // Reset local quantity back to 1
    setLocalQuantities({
      ...localQuantities,
      [menuItem.name]: 1
    });
  };

  // Owner/Admin Price editing trigger
  const handleStartPriceEdit = (menuItem) => {
    setEditingMenuItem(menuItem);
    setNewPriceValue(menuItem.price.toString());
    setPriceEditModalVisible(true);
  };

  const handleSavePriceEdit = () => {
    const parsedPrice = parseInt(newPriceValue);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert("ত্রুটি", "সঠিক মূল্য দিন!");
      return;
    }

    onUpdateMenuPrice(editingMenuItem.name, parsedPrice, editingMenuItem.category);

    // Also update active cart items price if this item is in the cart
    if (!editMode && table.id) {
      const updatedCart = cartItems.map(item =>
        item.name === editingMenuItem.name ? { ...item, price: parsedPrice } : item
      );
      onUpdateTableItems(table.id, updatedCart);
    }

    setPriceEditModalVisible(false);
    setEditingMenuItem(null);
  };

  const handleSaveNewItem = () => {
    const parsedPrice = parseInt(newItemPrice);
    if (!newItemName.trim() || isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert("ত্রুটি", "সঠিক তথ্য দিন!");
      return;
    }
    
    const cleanName = newItemName.trim();
    const cleanCategory = newItemCategory;
    const existing = menuItems.find(
      item => item.name.toLowerCase() === cleanName.toLowerCase() && 
              item.category.toLowerCase() === cleanCategory.toLowerCase()
    );
    if (existing) {
      Alert.alert(
        "আইটেম ইতিমধ্যে বিদ্যমান",
        `"${cleanName}" ইতিমধ্যে মেনুতে আছে। আপনি কি এটির মূল্য পরিবর্তন করে ৳${parsedPrice} করতে চান?`,
        [
          { text: "না", style: "cancel" },
          { 
            text: "হ্যাঁ", 
            onPress: () => {
              onAddMenuItem({
                id: existing.id,
                name: existing.name,
                price: parsedPrice,
                category: cleanCategory
              });
              setAddItemModalVisible(false);
              setNewItemName('');
              setNewItemPrice('');
              Alert.alert("সফল", "আইটেমটির মূল্য সফলভাবে পরিবর্তন করা হয়েছে!");
            }
          }
        ]
      );
      return;
    }
    
    onAddMenuItem({
      name: cleanName,
      price: parsedPrice,
      category: cleanCategory
    });

    setAddItemModalVisible(false);
    setNewItemName('');
    setNewItemPrice('');
    Alert.alert("সফল", "নতুন আইটেম যোগ করা হয়েছে!");
  };

  // Categories list matching mockup
  const categories = ['সব', 'বার্গার', 'ফ্রাই', 'নুডুলস', 'চিকেন', 'রাইস', 'স্ন্যাকস', 'পিজ্জা', 'ড্রিংকস'];

  const normalizeCategory = (cat) => {
    if (!cat) return '';
    const s = String(cat).trim();
    const lower = s.toLowerCase();
    if (s === 'ড্রিঙ্কস' || s === 'ড্রিংকস' || lower === 'drinks') return 'ড্রিংকস';
    if (s === 'পিজ্জা' || s === 'পিজা' || lower === 'pizza') return 'পিজ্জা';
    if (s === 'বার্গার' || lower === 'burger') return 'বার্গার';
    if (s === 'ফ্রাই' || lower === 'fry' || lower === 'fries') return 'ফ্রাই';
    if (s === 'নুডুলস' || s === 'নুডলস' || lower === 'noodles') return 'নুডুলস';
    if (s === 'চিকেন' || lower === 'chicken') return 'চিকেন';
    if (s === 'রাইস' || lower === 'rice') return 'রাইস';
    if (s === 'স্ন্যাকস' || s === 'স্ন্যাক্স' || lower === 'snacks') return 'স্ন্যাকস';
    return s;
  };

  // Filter items based on Category & Search Query (Water is hidden - Rule 1)
  const getFilteredItemsGrouped = () => {
    const query = searchQuery.trim().toLowerCase();
    
    // Filter
    let filtered = menuItems.filter(item => item.name !== 'পানি');
    
    if (selectedCategory !== 'সব') {
      filtered = filtered.filter(item => normalizeCategory(item.category) === normalizeCategory(selectedCategory));
    }
    
    if (query) {
      filtered = filtered.filter(item => item.name.toLowerCase().includes(query));
    }

    // Group by category
    const grouped = {};
    filtered.forEach(item => {
      const normalizedCat = normalizeCategory(item.category);
      if (!grouped[normalizedCat]) {
        grouped[normalizedCat] = [];
      }
      grouped[normalizedCat].push(item);
    });

    return grouped;
  };

  const groupedItems = getFilteredItemsGrouped();
  const isAuthorized = userRole === 'owner' || userRole === 'admin';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backArrow}>⬅</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editMode ? 'মেনু পরিবর্তন (Admin/Owner)' : 'আইটেম যোগ করুন'}</Text>
        {editMode ? (
          <TouchableOpacity onPress={() => setAddItemModalVisible(true)} style={styles.addButton}>
            <Text style={styles.addButtonText}>➕ নতুন</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchWrapper}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="আইটেম খুঁজুন..."
            placeholderTextColor="#888888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchIcon}>❌</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Categories Row */}
      <View style={styles.categoryScrollWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.catTab, selectedCategory === cat && styles.catTabActive]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.catTabText, selectedCategory === cat && styles.catTabTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Grouped Items List */}
      <ScrollView showsVerticalScrollIndicator={true} style={styles.scrollBody} contentContainerStyle={styles.scrollContent}>
        {Object.keys(groupedItems).length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>কোনো আইটেম পাওয়া যায়নি!</Text>
          </View>
        ) : (
          Object.keys(groupedItems).map(categoryName => (
            <View key={categoryName} style={styles.categorySection}>
              {/* Category Section Title Header */}
              <View style={styles.categoryTitleRow}>
                <View style={styles.categoryTitleLeft}>
                  <Text style={styles.categoryEmoji}>
                    {categoryName === 'বার্গার' ? '🍔' :
                     categoryName === 'ফ্রাই' ? '🍟' :
                     categoryName === 'নুডুলস' ? '🍜' :
                     categoryName === 'চিকেন' ? '🍗' :
                     categoryName === 'রাইস' ? '🍛' :
                     categoryName === 'স্ন্যাকস' ? '🥪' :
                     categoryName === 'পিজ্জা' ? '🍕' : '🥤'}
                  </Text>
                  <Text style={styles.categoryTitleText}>{categoryName}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedCategory(categoryName)}>
                  <Text style={styles.seeAllText}>সব দেখুন ➔</Text>
                </TouchableOpacity>
              </View>

              {/* Items in this Category */}
              <View style={styles.itemsListWrapper}>
                {groupedItems[categoryName].map((item, idx) => {
                  const cartQty = getCartQty(item.name);
                  const isInCart = cartQty > 0;
                  const displayQty = isInCart ? cartQty : getLocalQty(item.name);

                  return (
                    <View key={idx} style={styles.itemRow}>
                      {/* Name & Price */}
                      <View style={styles.itemInfo}>
                        <TouchableOpacity 
                          onLongPress={() => isAuthorized && handleStartPriceEdit(item)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.itemNameText}>{item.name}</Text>
                        </TouchableOpacity>
                        <View style={styles.priceRow}>
                          <Text style={styles.itemPriceText}>৳ {item.price}</Text>
                          {isAuthorized && (
                            <TouchableOpacity onPress={() => handleStartPriceEdit(item)}>
                              <Text style={styles.editPricePencil}>✏️</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Quantity Selector controls in the middle */}
                      {!editMode && (
                        <View style={styles.qtyCol}>
                          <View style={styles.qtyContainer}>
                            <TouchableOpacity 
                              style={styles.qtyBtn} 
                              onPress={() => isInCart ? handleDecreaseCartQty(item.name) : handleDecreaseLocalQty(item.name)}
                            >
                              <Text style={styles.qtyBtnTextMinus}>-</Text>
                            </TouchableOpacity>
                            
                            <Text style={styles.qtyValue}>{displayQty}</Text>
                            
                            <TouchableOpacity 
                              style={[styles.qtyBtn, styles.qtyBtnPlus]} 
                              onPress={() => isInCart ? handleIncreaseCartQty(item.name) : handleIncreaseLocalQty(item.name)}
                            >
                              <Text style={styles.qtyBtnTextPlus}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}

                      {/* Plus Add Button on the right */}
                      {!editMode ? (
                        <View style={styles.addCol}>
                          <TouchableOpacity
                            style={[styles.addBtn, isInCart && styles.addBtnActive]}
                            onPress={() => isInCart ? Alert.alert("কার্ট আপডেট", "আইটেমটি ইতিমধ্যে অর্ডারে আছে। পরিমাণ পরিবর্তন করতে মাঝের বাটনে চাপুন।") : handleAddItem(item)}
                            activeOpacity={0.85}
                          >
                            <Text style={[styles.addBtnText, isInCart && styles.addBtnTextActive]}>
                              {isInCart ? '✓ অর্ডারে আছে' : '+ যোগ করুন'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        isAuthorized && (
                          <View style={{ flexDirection: 'row' }}>
                            <TouchableOpacity 
                              style={[styles.addBtn, { borderColor: '#34D399', marginRight: 6 }]} 
                              onPress={() => handleStartPriceEdit(item)}
                            >
                              <Text style={[styles.addBtnText, { color: '#34D399' }]}>এডিট</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={[styles.addBtn, { borderColor: '#EF4444' }]} 
                              onPress={() => onDeleteMenuItem(item.name, item.category)}
                            >
                              <Text style={[styles.addBtnText, { color: '#EF4444' }]}>ডিলিট</Text>
                            </TouchableOpacity>
                          </View>
                        )
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Sticky Bottom Summary Drawer Bar */}
      {!editMode && (
        <View style={styles.bottomDrawer}>
          <View style={styles.bottomLeft}>
            <View style={styles.cartIconCircle}>
              <Text style={styles.cartIconText}>🛒</Text>
              {totalItemsCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{totalItemsCount}</Text>
                </View>
              )}
            </View>
            <View style={styles.summaryMeta}>
              <Text style={styles.summaryItemsText}>অর্ডারে আইটেম: {totalItemsCount} টি</Text>
              <Text style={styles.summaryAmountText}>মোট পরিমাণ: ৳ {totalAmount}</Text>
            </View>
          </View>
          
          <TouchableOpacity style={styles.viewCartBtn} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.viewCartText}>দেখুন</Text>
            <Text style={styles.viewCartArrow}>➔</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ==================== PRICE EDIT MODAL (Owner Only) ==================== */}
      <Modal
        visible={priceEditModalVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setPriceEditModalVisible(false)}
      >
        <View style={styles.modalBgCenter}>
          <View style={styles.editModalContent}>
            <Text style={styles.editModalTitle}>মূল্য পরিবর্তন করুন</Text>
            <Text style={styles.editModalSubtitle}>{editingMenuItem?.name}</Text>
            
            <View style={styles.editInputRow}>
              <Text style={styles.editInputSymbol}>৳</Text>
              <TextInput
                style={styles.editInput}
                keyboardType="numeric"
                value={newPriceValue}
                onChangeText={setNewPriceValue}
                autoFocus={true}
              />
            </View>

            <View style={styles.editActionRow}>
              <TouchableOpacity
                style={[styles.editBtnCancel]}
                onPress={() => setPriceEditModalVisible(false)}
              >
                <Text style={styles.editBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editBtnSave]}
                onPress={handleSavePriceEdit}
              >
                <Text style={styles.editBtnSaveText}>সংরক্ষণ করুন</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================== ADD NEW ITEM MODAL ==================== */}
      <Modal
        visible={addItemModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAddItemModalVisible(false)}
      >
        <View style={styles.modalBgCenter}>
          <View style={[styles.editModalContent, { width: '90%' }]}>
            <Text style={styles.editModalTitle}>নতুন আইটেম যোগ করুন</Text>
            
            <View style={[styles.editInputRow, { width: '100%', marginTop: 20 }]}>
              <TextInput
                style={styles.editInput}
                value={newItemName}
                onChangeText={setNewItemName}
                placeholder="আইটেমের নাম"
                placeholderTextColor="#666"
              />
            </View>

            <View style={[styles.editInputRow, { width: '100%', marginTop: 10 }]}>
              <Text style={styles.editInputSymbol}>৳</Text>
              <TextInput
                style={styles.editInput}
                keyboardType="numeric"
                value={newItemPrice}
                onChangeText={setNewItemPrice}
                placeholder="মূল্য"
                placeholderTextColor="#666"
              />
            </View>

            <Text style={[styles.inputLabel, { marginTop: 10, alignSelf: 'flex-start', color: '#FFF' }]}>ক্যাটাগরি সিলেক্ট করুন:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 40, marginTop: 10 }}>
              {categories.filter(c => c !== 'সব').map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catTab, newItemCategory === cat && styles.catTabActive, { height: 36, paddingVertical: 0, justifyContent: 'center' }]}
                  onPress={() => setNewItemCategory(cat)}
                >
                  <Text style={[styles.catTabText, newItemCategory === cat && styles.catTabTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={[styles.editActionRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={[styles.editBtnCancel]}
                onPress={() => setAddItemModalVisible(false)}
              >
                <Text style={styles.editBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editBtnSave]}
                onPress={handleSaveNewItem}
              >
                <Text style={styles.editBtnSaveText}>যোগ করুন</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#161616',
    backgroundColor: '#0D0D0D',
  },
  backButton: {
    padding: 6,
  },
  backArrow: {
    fontSize: 20,
    color: '#FFB703',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  addButton: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#34D399',
  },
  addButtonText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: 'bold',
  },
  searchContainer: {
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    height: '100%',
  },
  clearSearchIcon: {
    fontSize: 12,
    padding: 4,
  },
  categoryScrollWrapper: {
    backgroundColor: '#050505',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  categoryScroll: {
    paddingHorizontal: 12,
  },
  catTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    marginRight: 8,
  },
  catTabActive: {
    backgroundColor: '#FFB703',
    borderColor: '#FFB703',
  },
  catTabText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: 'bold',
  },
  catTabTextActive: {
    color: '#000000',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110, // Generous padding to clear the bottom sticky cart drawer
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888888',
    fontSize: 14,
  },
  categorySection: {
    marginBottom: 24,
  },
  categoryTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#161616',
    paddingBottom: 6,
  },
  categoryTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryEmoji: {
    fontSize: 18,
    marginRight: 8,
  },
  categoryTitleText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  seeAllText: {
    fontSize: 12,
    color: '#FFB703',
  },
  itemsListWrapper: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#161616',
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#161616',
  },
  itemInfo: {
    flex: 3.5,
  },
  itemNameText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  itemPriceText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFB703',
  },
  editPricePencil: {
    fontSize: 11,
    marginLeft: 6,
    opacity: 0.8,
  },
  qtyCol: {
    flex: 3.2,
    alignItems: 'center',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262626',
  },
  qtyBtn: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  qtyBtnPlus: {
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
  },
  qtyBtnTextMinus: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FF4D4D',
  },
  qtyBtnTextPlus: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#34D399',
  },
  qtyValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 8,
  },
  addCol: {
    flex: 3.3,
    alignItems: 'flex-end',
  },
  addBtn: {
    borderWidth: 1,
    borderColor: '#FFB703',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 78,
    alignItems: 'center',
  },
  addBtnActive: {
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderColor: '#34D399',
  },
  addBtnText: {
    color: '#FFB703',
    fontSize: 11,
    fontWeight: 'bold',
  },
  addBtnTextActive: {
    color: '#34D399',
  },
  
  // Bottom Sticky Cart Drawer Style
  bottomDrawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0D0D0D',
    borderTopWidth: 1,
    borderColor: '#1C1C1C',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cartIconCircle: {
    backgroundColor: 'rgba(255, 183, 3, 0.12)',
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    position: 'relative',
  },
  cartIconText: {
    fontSize: 20,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF4D4D',
    borderRadius: 8,
    width: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  summaryMeta: {
    justifyContent: 'center',
  },
  summaryItemsText: {
    fontSize: 11,
    color: '#888888',
  },
  summaryAmountText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 2,
  },
  viewCartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#FFB703',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  viewCartText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 4,
  },
  viewCartArrow: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Modal styles (Owner Only Price Modal)
  modalBgCenter: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  editModalContent: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 20,
    width: '100%',
    padding: 20,
    alignItems: 'center',
  },
  editModalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  editModalSubtitle: {
    fontSize: 14,
    color: '#FFB703',
    fontWeight: 'bold',
    marginTop: 6,
    textAlign: 'center',
  },
  editInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    width: '70%',
    height: 52,
    paddingHorizontal: 16,
    marginVertical: 20,
  },
  editInputSymbol: {
    fontSize: 18,
    color: '#FFB703',
    fontWeight: 'bold',
    marginRight: 8,
  },
  editInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    height: '100%',
  },
  editActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  editBtnCancel: {
    flex: 1,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    marginRight: 10,
  },
  editBtnCancelText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  editBtnSave: {
    flex: 1.5,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFB703',
    borderRadius: 10,
  },
  editBtnSaveText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
